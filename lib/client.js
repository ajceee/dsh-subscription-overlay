window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-subscription-overlay",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region src/client/controller.ts
		/**
		* Panel controller: bridges the plugin's same-origin HTTP API
		* (/plugins/dsh-subscription-overlay/api) onto a snapshot store.
		*
		* Adapted from dsh-quota's QuotaPanelController (SPIKE §1): fresh minimal
		* surface — status reload (pure cache serve), manual refresh, probe relay.
		* Polling short-circuits when the overlay is hidden
		* (acceptance: hidden toggle unmounts pill AND panel, no background fetch).
		*
		* The store is a real HostObservable (`createSnapshotStore` from
		* `@deepseek-ai/dsh-client-store`), so the shell synthesizes the
		* `useSubscriptionOverlay` selector hook for the panel from the
		* `hooks: { subscriptionOverlay }` compartment.
		*
		* @module dsh-subscription-overlay/client/controller
		*/
		/** Initial snapshot before the first status read. */
		const INITIAL = {
			loaded: false,
			busy: false,
			open: false,
			visible: true,
			mode: "pill",
			display: "dock",
			refreshedAt: 0,
			providers: [],
			alertPct: 85,
			pollMinutes: 5,
			enabled: true,
			formError: "",
			probing: ""
		};
		const API_PREFIX = "/plugins/dsh-subscription-overlay/api";
		/** Normalize refreshedAt (epoch ms number, ISO tolerated) to epoch ms. */
		function toEpochMs(value) {
			if (typeof value === "number" && Number.isFinite(value)) return value;
			if (typeof value === "string" && value !== "") {
				const ms = new Date(value).getTime();
				return Number.isNaN(ms) ? 0 : ms;
			}
			return 0;
		}
		/** Count alert-worthy rows: provider errors + usage items at/above the threshold. */
		function alertCount(snapshot) {
			return snapshot.providers.filter((p) => p.status === "ok" && Array.isArray(p.items)).reduce((n, p) => n + p.items.filter((i) => typeof i.percent === "number" && i.percent >= snapshot.alertPct).length, 0) + snapshot.providers.filter((p) => p.status === "error").length;
		}
		/** Headline percent item of a provider card (5h window preferred, else first with %). */
		function headlineItem(p) {
			const withPct = (Array.isArray(p.items) ? p.items : []).filter((i) => typeof i.percent === "number");
			return withPct.find((i) => /5\s*h/i.test(i.label)) ?? withPct[0];
		}
		/** One-line summary of a provider's headline windows ("5h 20% left · 7d 36% left"). */
		function summarizeProvider(p) {
			if (!p || p.status !== "ok" || !Array.isArray(p.items)) return "";
			const head = (item) => {
				if (typeof item.percent !== "number") return item.display;
				const tag = /5\s*h/i.test(item.label) ? "5h" : /7\s*d/i.test(item.label) ? "7d" : /30\s*d/i.test(item.label) ? "30d" : /month/i.test(item.label) ? "mo" : /primary/i.test(item.label) ? "pri" : /secondary/i.test(item.label) ? "sec" : "";
				const value = `${Math.max(0, Math.round(100 - item.percent))}% left`;
				return tag !== "" ? `${tag} ${value}` : value;
			};
			const headlines = p.items.filter((i) => typeof i.percent === "number");
			return (headlines.length > 0 ? headlines : p.items).map(head).filter((v) => typeof v === "string" && v !== "").slice(0, 2).join(" · ");
		}
		/** Drives the panel off the plugin's HTTP API. */
		var OverlayController = class {
			store;
			pollMinutes = 5;
			lastPollAttempt = 0;
			constructor(initial) {
				this.store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({
					...INITIAL,
					...initial
				});
			}
			/** Merge a local patch into the snapshot. */
			patch(patch) {
				this.store.set({
					...this.store.getSnapshot(),
					...patch
				});
			}
			/** Periodic re-read; no-op while hidden, busy, tab-backgrounded, or within cadence. */
			pollIfVisible() {
				const snapshot = this.store.getSnapshot();
				if (!snapshot.visible) return;
				if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
				if (snapshot.busy) return;
				const now = Date.now();
				if (now - this.lastPollAttempt < this.getPollMs()) return;
				this.lastPollAttempt = now;
				this.reload();
			}
			/** Apply the poll cadence the host reports (settings section edits it live). */
			setPollMinutes(minutes) {
				if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 60) this.pollMinutes = minutes;
			}
			getPollMs() {
				return this.pollMinutes * 60 * 1e3;
			}
			/** Build the face the slot registration injects. */
			inject() {
				return {
					hooks: { subscriptionOverlay: this.store },
					toggle: () => {
						const next = !this.store.getSnapshot().open;
						this.patch({ open: next });
						if (next) this.reload();
					},
					close: () => this.patch({ open: false }),
					setVisible: (visible) => {
						this.patch({
							visible,
							open: visible ? this.store.getSnapshot().open : false
						});
						if (visible) this.reload();
					},
					setMode: (mode) => this.patch({ mode }),
					setDisplay: (display) => this.patch({ display }),
					refresh: () => {
						this.refresh();
					},
					probe: () => {
						this.probeCommandcode();
					}
				};
			}
			/** Read the snapshot (initial load, opening the panel). */
			async reload() {
				try {
					const state = await request("/status", void 0);
					this.applyStatus(state);
				} catch (error) {
					this.patch({
						loaded: true,
						formError: error instanceof Error ? error.message : String(error)
					});
				}
			}
			/** Ask the host to re-fetch every provider snapshot. */
			async refresh() {
				this.patch({
					busy: true,
					formError: ""
				});
				try {
					const state = await request("/refresh", {});
					this.applyStatus(state);
				} catch (error) {
					this.patch({ formError: error instanceof Error ? error.message : String(error) });
				} finally {
					this.patch({ busy: false });
				}
			}
			/** One-shot commandcode `/models` probe (latency + model list, never a %). */
			async probeCommandcode() {
				this.patch({ probing: "commandcode" });
				try {
					await request("/probe", { platform: "commandcode" });
					await this.reload();
				} catch (error) {
					this.patch({ formError: error instanceof Error ? error.message : String(error) });
				} finally {
					this.patch({ probing: "" });
				}
			}
			applyStatus(state) {
				const providers = Array.isArray(state["providers"]) ? state["providers"] : [];
				const overlay = state["overlay"] ?? {};
				const patch = {
					loaded: true,
					refreshedAt: toEpochMs(state["refreshedAt"]),
					providers
				};
				if (typeof state["alertPct"] === "number") patch.alertPct = state["alertPct"];
				if (typeof state["pollMinutes"] === "number") {
					patch.pollMinutes = state["pollMinutes"];
					this.setPollMinutes(state["pollMinutes"]);
				}
				if (typeof state["enabled"] === "boolean") {
					patch.enabled = state["enabled"];
					if (!state["enabled"]) {
						patch.visible = false;
						patch.open = false;
					}
				}
				if (overlay.mode === "pill" || overlay.mode === "ring") {
					patch.mode = overlay.mode;
					try {
						window.localStorage.setItem(MODE_KEY, overlay.mode);
					} catch {}
				}
				if (overlay.display === "dock" || overlay.display === "floater") {
					patch.display = overlay.display;
					try {
						window.localStorage.setItem(DISPLAY_KEY, overlay.display);
					} catch {}
				}
				this.store.set({
					...this.store.getSnapshot(),
					...patch
				});
			}
		};
		/** Same-origin JSON call against the plugin API; POSTs carry the CSRF header. */
		async function request(path, body) {
			const response = await fetch(`${API_PREFIX}${path}`, {
				method: body === void 0 ? "GET" : "POST",
				...body !== void 0 ? {
					headers: {
						"content-type": "application/json",
						"x-dsh-subscription-overlay": "1"
					},
					body: JSON.stringify(body)
				} : {}
			});
			if (!response.ok) throw new Error(`Plugin request failed (HTTP ${response.status})`);
			const data = await response.json();
			if (body !== void 0 && typeof data["statusMessage"] === "string") throw new Error(data["statusMessage"]);
			return data;
		}
		/** localStorage key for the floater shape (pill | ring). */
		const MODE_KEY = "dsh-subscription-overlay:mode";
		/** localStorage key for overlay visibility ("1" | "0"). */
		const VISIBLE_KEY = "dsh-subscription-overlay:visible";
		/** localStorage key for the mount point (dock | floater). */
		const DISPLAY_KEY = "dsh-subscription-overlay:display";
		/** localStorage key for the user-dragged pill/ring position. */
		const POS_KEY = "dsh-subscription-overlay:pos";
		//#endregion
		//#region src/client/OverlaySettingsSection.tsx
		/**
		* `settings.section` page for the overlay.
		*
		* Grouped layout: General / Appearance / Refresh / Alerts / Providers.
		* Provider rows render from the host `providerCatalog` (/status), so new
		* llm-pi-ai providers appear automatically (marked unsupported until a
		* bespoke quota fetcher exists). Poll interval, alert threshold and overlay
		* mode are dropdowns; the hotkey is display-only.
		* Reads the current config from GET /api/status and writes through
		* POST /api/settings (the host owns validation + persistence; the client
		* only sends well-formed values and surfaces host errors).
		*
		* API keys never live here — credential refs only.
		*
		* @module dsh-subscription-overlay/client/OverlaySettingsSection
		*/
		const S = {
			"settings.title": "Subscription Overlay",
			"settings.desc": "Controls the desktop floater and the quota panel. New providers you configure under llm-pi-ai appear below automatically; quota bars need a dedicated fetcher per vendor.",
			"settings.general": "General",
			"settings.enabled": "Show overlay",
			"settings.enabledHint": "Off unmounts the pill/ring and the panel and stops background refreshes.",
			"settings.appearance": "Appearance",
			"settings.mode": "Floater style",
			"settings.modeHint": "Pill shows provider names; ring shows remaining quota as a circle.",
			"settings.mode.pill": "Pill",
			"settings.mode.ring": "Ring",
			"settings.display": "Show quotas in",
			"settings.displayHint": "Dock replaces the Subscriptions pill in the composer; floater keeps the draggable desktop pill/ring.",
			"settings.display.dock": "Composer dock",
			"settings.display.floater": "Desktop floater",
			"settings.hotkey": "Toggle hotkey",
			"settings.hotkeyHint": "Press anywhere to show or hide the overlay.",
			"settings.refresh": "Auto-refresh",
			"settings.pollMinutes": "Check quotas every",
			"settings.pollHint": "Manual Refresh in the panel always fetches immediately.",
			"settings.poll.1": "Every minute",
			"settings.poll.2": "Every 2 minutes",
			"settings.poll.5": "Every 5 minutes",
			"settings.poll.10": "Every 10 minutes",
			"settings.poll.15": "Every 15 minutes",
			"settings.poll.30": "Every 30 minutes",
			"settings.poll.60": "Every hour",
			"settings.alerts": "Alerts",
			"settings.alertPct": "Warn me at",
			"settings.alertHint": "Bars turn red and the floater shows a badge once usage reaches this level.",
			"settings.alertSuffix": "used",
			"settings.providers": "Providers",
			"settings.providersHint": "Switch a provider off to hide it from the panel.",
			"settings.unsupported": "Quota not supported yet",
			"settings.save": "Save",
			"settings.saving": "Saving…",
			"settings.saved": "Saved",
			"settings.loadError": "Failed to read settings: {message}",
			"settings.saveError": "Failed to save: {message}"
		};
		function tx(key, params) {
			let text = S[key];
			if (params) for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
			return text;
		}
		const DEFAULT_FORM = {
			enabled: true,
			providers: {
				claude: true,
				codex: true,
				opencodeGo: true,
				commandcode: true
			},
			catalog: [],
			pollMinutes: "5",
			alertPct: "85",
			mode: "pill",
			display: "dock",
			hotkey: "Ctrl+Shift+S"
		};
		const POLL_OPTIONS = [
			"1",
			"2",
			"5",
			"10",
			"15",
			"30",
			"60"
		];
		const ALERT_OPTIONS = [
			"50",
			"60",
			"70",
			"80",
			"85",
			"90",
			"95"
		];
		function formFromStatus(status) {
			const raw = status["settings"] ?? {};
			const saved = raw["providers"] ?? {};
			const overlay = raw["overlay"] ?? status["overlay"] ?? {};
			const catalogRaw = status["providerCatalog"];
			const catalog = Array.isArray(catalogRaw) ? catalogRaw.map((e) => ({
				key: typeof e["key"] === "string" ? e["key"] : "",
				label: typeof e["label"] === "string" ? e["label"] : String(e["key"] ?? ""),
				detail: typeof e["detail"] === "string" ? e["detail"] : "",
				supported: e["supported"] === true
			})).filter((e) => e.key !== "") : [];
			const providers = {};
			for (const e of catalog) {
				const v = saved[e.key];
				providers[e.key] = typeof v === "boolean" ? v : true;
			}
			for (const k of [
				"claude",
				"codex",
				"opencodeGo",
				"commandcode"
			]) if (!(k in providers)) {
				const v = saved[k];
				providers[k] = typeof v === "boolean" ? v : true;
			}
			const pick = (value, options, fallback) => {
				const s = typeof value === "number" && Number.isFinite(value) ? String(value) : fallback;
				return options.includes(s) ? s : fallback;
			};
			return {
				enabled: typeof raw["enabled"] === "boolean" ? raw["enabled"] : status["enabled"] ?? true,
				providers,
				catalog,
				pollMinutes: pick(raw["pollMinutes"] ?? status["pollMinutes"], POLL_OPTIONS, "5"),
				alertPct: pick(raw["alertPct"] ?? status["alertPct"], ALERT_OPTIONS, "85"),
				mode: overlay.mode === "ring" ? "ring" : "pill",
				display: overlay.display === "floater" ? "floater" : "dock",
				hotkey: typeof overlay.hotkey === "string" && overlay.hotkey !== "" ? overlay.hotkey : "Ctrl+Shift+S"
			};
		}
		/** Mirror persisted settings into the overlay's localStorage keys (no second GET). */
		function mirrorSettingsToLocal(settings) {
			if (!settings) return;
			try {
				if (typeof settings["enabled"] === "boolean") window.localStorage.setItem("dsh-subscription-overlay:visible", settings["enabled"] ? "1" : "0");
				const overlay = settings["overlay"];
				if (overlay?.mode === "pill" || overlay?.mode === "ring") window.localStorage.setItem("dsh-subscription-overlay:mode", overlay.mode);
				if (overlay?.display === "dock" || overlay?.display === "floater") window.localStorage.setItem("dsh-subscription-overlay:display", overlay.display);
			} catch {}
		}
		async function api(path, body) {
			const response = await fetch(`${API_PREFIX}${path}`, {
				method: body === void 0 ? "GET" : "POST",
				...body !== void 0 ? {
					headers: {
						"content-type": "application/json",
						"x-dsh-subscription-overlay": "1"
					},
					body: JSON.stringify(body)
				} : {}
			});
			if (!response.ok) throw new Error("Plugin request failed");
			const data = await response.json();
			if (body !== void 0 && typeof data["statusMessage"] === "string") throw new Error(data["statusMessage"]);
			return data;
		}
		/** Settings section body (the shell provides nav + header around it). */
		function OverlaySettingsSection() {
			const [form, setForm] = (0, react.useState)(DEFAULT_FORM);
			const [loading, setLoading] = (0, react.useState)(true);
			const [saving, setSaving] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const [saved, setSaved] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				let live = true;
				api("/meta").then((status) => {
					if (live) setForm(formFromStatus(status));
				}).catch((err) => {
					if (live) setError(tx("settings.loadError", { message: err instanceof Error ? err.message : String(err) }));
				}).finally(() => {
					if (live) setLoading(false);
				});
				return () => {
					live = false;
				};
			}, []);
			const setProvider = (key, value) => {
				setForm((prev) => ({
					...prev,
					providers: {
						...prev.providers,
						[key]: value
					}
				}));
				setSaved(false);
			};
			const set = (key, value) => {
				setForm((prev) => ({
					...prev,
					[key]: value
				}));
				setSaved(false);
			};
			const save = () => {
				const patch = {
					enabled: form.enabled,
					pollMinutes: Number(form.pollMinutes),
					alertPct: Number(form.alertPct),
					providers: {
						claude: form.providers["claude"] ?? true,
						codex: form.providers["codex"] ?? true,
						opencodeGo: form.providers["opencodeGo"] ?? true,
						commandcode: form.providers["commandcode"] ?? true
					},
					overlay: {
						mode: form.mode,
						display: form.display
					}
				};
				setSaving(true);
				setError("");
				api("/settings", patch).then((result) => {
					mirrorSettingsToLocal(result["settings"]);
					setSaved(true);
				}).catch((err) => {
					setError(tx("settings.saveError", { message: err instanceof Error ? err.message : String(err) }));
				}).finally(() => {
					setSaving(false);
				});
			};
			if (loading) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dso-section",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dso-section-hint",
					children: "Refreshing…"
				})
			});
			const rows = form.catalog.length > 0 ? form.catalog : [
				"claude",
				"codex",
				"opencodeGo",
				"commandcode"
			].map((key) => ({
				key,
				label: key,
				detail: "",
				supported: true
			}));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dso-section",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dso-section-hint",
						children: tx("settings.desc")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dso-section-group",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dso-section-group-title",
								children: tx("settings.general")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dso-section-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
									htmlFor: "dso-settings-enabled",
									children: tx("settings.enabled")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
									id: "dso-settings-enabled",
									on: form.enabled,
									onFlip: () => set("enabled", !form.enabled)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dso-section-hint",
								children: tx("settings.enabledHint")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dso-section-group",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dso-section-group-title",
								children: tx("settings.appearance")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dso-section-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
									htmlFor: "dso-settings-mode",
									children: tx("settings.mode")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									id: "dso-settings-mode",
									className: "dso-select",
									value: form.mode,
									onChange: (e) => set("mode", e.currentTarget.value === "ring" ? "ring" : "pill"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "pill",
										children: tx("settings.mode.pill")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "ring",
										children: tx("settings.mode.ring")
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dso-section-hint",
								children: tx("settings.modeHint")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dso-section-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
									htmlFor: "dso-settings-display",
									children: tx("settings.display")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									id: "dso-settings-display",
									className: "dso-select",
									value: form.display,
									onChange: (e) => set("display", e.currentTarget.value === "floater" ? "floater" : "dock"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "dock",
										children: tx("settings.display.dock")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "floater",
										children: tx("settings.display.floater")
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dso-section-hint",
								children: tx("settings.displayHint")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dso-section-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { flex: 1 },
									children: tx("settings.hotkey")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: form.hotkey })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dso-section-hint",
								children: tx("settings.hotkeyHint")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dso-section-group",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dso-section-group-title",
								children: tx("settings.refresh")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dso-section-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
									htmlFor: "dso-settings-poll",
									children: tx("settings.pollMinutes")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									id: "dso-settings-poll",
									className: "dso-select",
									value: form.pollMinutes,
									onChange: (e) => set("pollMinutes", e.currentTarget.value),
									children: POLL_OPTIONS.map((v) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: v,
										children: tx(`settings.poll.${v}`)
									}, v))
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dso-section-hint",
								children: tx("settings.pollHint")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dso-section-group",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dso-section-group-title",
								children: tx("settings.alerts")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dso-section-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
									htmlFor: "dso-settings-alert",
									children: tx("settings.alertPct")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										display: "inline-flex",
										alignItems: "center",
										gap: 6
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
										id: "dso-settings-alert",
										className: "dso-select",
										value: form.alertPct,
										onChange: (e) => set("alertPct", e.currentTarget.value),
										children: ALERT_OPTIONS.map((v) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
											value: v,
											children: [v, "%"]
										}, v))
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dso-section-hint",
										children: tx("settings.alertSuffix")
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dso-section-hint",
								children: tx("settings.alertHint")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dso-section-group",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dso-section-group-title",
								children: tx("settings.providers")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dso-section-hint",
								children: tx("settings.providersHint")
							}),
							rows.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dso-section-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: { flex: 1 },
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: entry.label }),
										entry.detail !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dso-section-note",
											children: entry.supported ? ` · ${entry.detail}` : ` · ${tx("settings.unsupported")}`
										}),
										!entry.supported && entry.detail === "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dso-section-note",
											children: ` · ${tx("settings.unsupported")}`
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
									id: `dso-settings-provider-${entry.key}`,
									on: entry.supported ? form.providers[entry.key] ?? true : false,
									onFlip: () => {
										if (entry.supported) setProvider(entry.key, !(form.providers[entry.key] ?? true));
									},
									disabled: !entry.supported
								})]
							}, entry.key))
						]
					}),
					error !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dso-section-error",
						children: error
					}),
					saved && error === "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dso-section-ok",
						children: tx("settings.saved")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dso-section-row dso-section-foot",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dso-btn dso-btn--primary",
							disabled: saving,
							onClick: save,
							children: saving ? tx("settings.saving") : tx("settings.save")
						})
					})
				]
			});
		}
		function Switch({ id, on, onFlip, disabled }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				id,
				type: "button",
				role: "switch",
				"aria-checked": on,
				disabled: disabled === true,
				className: `dso-switch${on ? " dso-switch--on" : ""}`,
				onClick: onFlip,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dso-switch-knob" })
			});
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* Stylesheet for the subscription pill/ring + panel. Consumes the shell's
		* alias tokens with local fallbacks, scoped under .dso- to avoid collisions
		* (quota uses .dq-).
		*
		* @module dsh-subscription-overlay/client/styles
		*/
		const STYLE_TAG_ID = "dsh-subscription-overlay/panel";
		const PANEL_CSS = `
.dso-root { position: fixed; right: 16px; bottom: 16px; z-index: 9999; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; font-family: inherit; }
.dso-pill {
  display: inline-flex; align-items: center; gap: 8px; cursor: grab; user-select: none;
  touch-action: none;
  padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 500;
  background: var(--dsw-alias-bg-layer-2, rgba(20, 20, 28, 0.92)); color: var(--dsw-alias-label-primary, #eee);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  transition: transform 0.12s ease, border-color 0.12s ease;
}
.dso-pill:hover { transform: translateY(-1px); border-color: var(--dsw-alias-brand-primary, #5b6cff); }
.dso-pill--dragging { cursor: grabbing; transition: none; }
.dso-pill--dragging:hover { transform: none; }
.dso-pill .dso-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dso-dot--ok { background: #3ddc84; box-shadow: 0 0 6px rgba(61, 220, 132, 0.7); }
.dso-dot--warn { background: #f5a623; box-shadow: 0 0 6px rgba(245, 166, 35, 0.7); }
.dso-dot--err { background: #e74c3c; box-shadow: 0 0 6px rgba(231, 76, 60, 0.7); }
.dso-dot--idle { background: #888; }
.dso-pill .dso-pill-name { max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dso-pill { position: relative; }

/* Alert badge: error providers + over-threshold rows. */
.dso-alert {
  position: absolute; top: -6px; right: -6px; min-width: 16px; height: 16px;
  padding: 0 4px; border-radius: 999px; box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center;
  background: #e74c3c; color: #fff; font-size: 10px; font-weight: 700; line-height: 1;
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-2, rgba(20, 20, 28, 0.92));
  animation: dso-alert-pulse 2s ease-in-out infinite; pointer-events: none;
}
@keyframes dso-alert-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.12); }
}

/* HUD ring: SVG circular progress (remaining quota), center = remaining %. */
.dso-ring {
  position: relative; width: 52px; height: 52px; padding: 0; cursor: grab; user-select: none;
  touch-action: none; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35));
  background: var(--dsw-alias-bg-layer-2, rgba(20, 20, 28, 0.92));
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  display: inline-flex; align-items: center; justify-content: center;
  transition: transform 0.12s ease, border-color 0.12s ease, opacity 0.2s ease;
}
.dso-ring:hover { transform: translateY(-1px); border-color: var(--dsw-alias-brand-primary, #5b6cff); }
.dso-ring-svg { width: 46px; height: 46px; display: block; }
.dso-ring-track { fill: none; stroke: rgba(128, 128, 128, 0.25); stroke-width: 4.5; }
.dso-ring-arc {
  fill: none; stroke-width: 4.5; stroke-linecap: round;
  transition: stroke-dashoffset 0.6s ease, stroke 0.3s ease;
}
.dso-ring-arc--ok { stroke: #3ddc84; }
.dso-ring-arc--warn { stroke: #f5a623; }
.dso-ring-arc--danger { stroke: #e74c3c; }
.dso-ring-text {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary, #eee); pointer-events: none;
  transition: opacity 0.3s ease;
}

/* Edge hugging: half-fade when dragged to a side edge, restore on hover. */
.dso-floater--edge-l { transform: translateX(-55%); opacity: 0.45; }
.dso-floater--edge-r { transform: translateX(55%); opacity: 0.45; }
.dso-floater--edge-l:hover, .dso-floater--edge-r:hover { transform: translateX(0); opacity: 1; }
.dso-pill .dso-pill-model {
  font-size: 11px; font-weight: 600; max-width: 210px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  padding: 1px 8px; border-radius: 999px;
  background: rgba(91, 108, 255, 0.14); color: var(--dsw-alias-brand-primary, #5b6cff);
}

.dso-panel {
  width: 340px; max-height: min(64vh, 600px); overflow-y: auto; border-radius: 14px;
  background: var(--dsw-alias-bg-layer-2, rgba(22, 22, 30, 0.97)); color: var(--dsw-alias-label-primary, #eee);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  display: flex; flex-direction: column;
}
.dso-panel-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2)); position: sticky; top: 0; background: inherit; border-radius: 14px 14px 0 0; }
.dso-panel-title { font-weight: 600; font-size: 14px; flex: 1; }
.dso-btn {
  padding: 5px 12px; border-radius: 8px; font-size: 12px; font-weight: 500; border: none; cursor: pointer;
  background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.15)); color: var(--dsw-alias-label-primary, #eee);
}
.dso-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.25)); }
.dso-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.dso-btn--primary { background: var(--dsw-static-blue-500, #3b82f6); color: #fff; }
.dso-btn--primary:hover:not(:disabled) { background: var(--dsw-static-blue-600, #2563eb); }
.dso-btn--ghost { background: transparent; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3)); }
.dso-btn--ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.1)); }

.dso-panel-body { padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.dso-provider { border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.22)); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.dso-provider-head { display: flex; align-items: center; gap: 8px; }
.dso-provider-name { font-weight: 600; font-size: 13px; flex: 1; }
.dso-badge { padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.dso-badge--ok { background: rgba(61, 220, 132, 0.16); color: #3ddc84; }
.dso-badge--error { background: rgba(231, 76, 60, 0.14); color: #e74c3c; }
.dso-badge--disabled { background: rgba(128, 128, 128, 0.16); color: #999; }
.dso-badge--loading { background: rgba(91, 108, 255, 0.14); color: #5b6cff; }
.dso-probe { padding: 2px 8px; font-size: 11px; flex: none; }
.dso-probe-line { font-size: 11px; font-variant-numeric: tabular-nums; word-break: break-all; color: var(--dsw-alias-label-secondary, #999); }
.dso-probe-line--err { color: #e74c3c; }
.dso-provider-msg { font-size: 11px; color: var(--dsw-alias-label-secondary, #999); word-break: break-all; }
.dso-items { display: flex; flex-direction: column; gap: 5px; }
.dso-item { display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; }
.dso-item-label { width: 96px; flex: none; color: var(--dsw-alias-label-secondary, #999); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dso-item-bar { flex: 1; min-width: 40px; height: 6px; border-radius: 3px; overflow: hidden; background: rgba(128, 128, 128, 0.22); }
/* display: block is required — the fill is an empty <span>, so as an inline
   box it collapses to zero width/height and the bar never paints. */
.dso-item-fill { display: block; height: 100%; border-radius: 3px; transition: width 0.3s ease; }
.dso-item-fill--ok { background: linear-gradient(90deg, #3ddc84, #00b4d8); }
.dso-item-fill--warn { background: linear-gradient(90deg, #f5a623, #f7ce46); }
.dso-item-fill--danger { background: linear-gradient(90deg, #e74c3c, #ff7b54); }
.dso-item-value { flex: none; text-align: right; color: var(--dsw-alias-label-secondary, #999); font-variant-numeric: tabular-nums; font-size: 11px; }
.dso-item-reset { width: 100%; font-size: 10px; color: var(--dsw-alias-label-tertiary, #777); text-align: right; margin-top: -3px; }

.dso-burn { display: flex; flex-direction: column; gap: 5px; border-top: 1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,0.25)); padding-top: 6px; }
.dso-burn-title { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary, #999); }
.dso-empty { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #999); padding: 8px 4px; }
.dso-foot { font-size: 11px; color: var(--dsw-alias-label-tertiary, #777); text-align: center; padding: 2px 0 4px; }

/* Settings section extras. */
.dso-section { display: flex; flex-direction: column; gap: 10px; padding: 4px 0; }
.dso-section-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.dso-section-row label { flex: 1; }
.dso-section-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary, #777); }
.dso-section-error { font-size: 12px; color: #e74c3c; }
.dso-section-ok { font-size: 12px; color: #3ddc84; }
.dso-input {
  width: 90px; padding: 6px 8px; border-radius: 8px; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3));
  background: var(--dsw-alias-bg-layer-1, transparent); color: var(--dsw-alias-label-primary, inherit); outline: none;
}
.dso-input:focus { border-color: var(--dsw-alias-brand-primary, #5b6cff); }
.dso-switch { position: relative; width: 36px; height: 20px; flex: none; padding: 0; border: none; border-radius: 999px; cursor: pointer; background: rgba(128, 128, 128, 0.35); transition: background 0.15s ease; }
.dso-switch--on { background: var(--dsw-static-blue-500, #3b82f6); }
.dso-switch-knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left 0.15s ease; }
.dso-switch--on .dso-switch-knob { left: 18px; }
.dso-switch:disabled { opacity: 0.45; cursor: not-allowed; }
.dso-section-group { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.22)); border-radius: 10px; }
.dso-section-group-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--dsw-alias-label-secondary, #999); }
.dso-section-note { font-size: 11px; color: var(--dsw-alias-label-tertiary, #777); }
.dso-section-foot { justify-content: flex-end; margin-top: 2px; }
.dso-select {
  padding: 6px 8px; border-radius: 8px; font-size: 12px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3));
  background: var(--dsw-alias-bg-layer-2, rgba(20, 20, 28, 0.92)); color: var(--dsw-alias-label-primary, #eee); outline: none;
}
.dso-select:focus { border-color: var(--dsw-alias-brand-primary, #5b6cff); }
.dso-select option { background: var(--dsw-alias-bg-layer-2, #1a1a24); color: var(--dsw-alias-label-primary, #eee); }
`;
		const DOCK_HIDE_TAG_ID = "dsh-subscription-overlay/dock-hide";
		/**
		* Hides ONLY the upstream `subscription-usage` pill while our dock badge is
		* active. The upstream pill is an inline-styled `<button>` (no stable class),
		* so both selectors fingerprint its mount structure instead of matching bare
		* dialog buttons (a bare `button[aria-haspopup="dialog"]` selector also kills
		* the host context + cache pills — never re-add one):
		*
		* - Portaled case (host stats row exists): the badge anchors its pill in a
		*   plain inline-flex `<span>` portaled directly under `[data-composer-stats]`
		*   (`SubscriptionUsageBadge.js`: `createPortal(pill, statsRow)`, anchor
		*   `styles.anchor = { minWidth: 0, maxWidth: '100%', display: 'inline-flex' }`).
		* - In-place case (no stats row): the badge renders an invisible seat
		*   (`<span aria-hidden="true" style="display:none">`) immediately followed by
		*   the pill anchor span, both under the dock outlet.
		*
		* Both selectors exclude our own pill via `:not([data-dso-dock])`, and this
		* tag is only mounted while `display === 'dock'` (managed in
		* `src/client/index.ts`), so disabling dock mode restores the upstream pill.
		* Safe-failure direction is under-hide: if neither fingerprint matches (new
		* host markup), the upstream pill reappears instead of hiding something else.
		* llm-subscriptions itself stays ENABLED so OAuth refresh keeps auth.json alive.
		*
		* TODO(live-DOM): confirm against the real composer DOM (unreachable headless:
		* boot needs DSH_VAULT_PASSWORD, :3081 is token-fenced). If the shell stamps
		* per-entry ids (e.g. `[data-slot-item="subscription-usage"]`), prefer that.
		*/
		const DOCK_HIDE_CSS = `
[data-composer-stats] > span[style*="inline-flex"] > button[aria-haspopup="dialog"][aria-label]:not([data-dso-dock]) {
  display: none !important;
}
[data-slot="conversation.composer.dock"] span[aria-hidden="true"] + span > button[aria-haspopup="dialog"]:not([data-dso-dock]) {
  display: none !important;
}
`;
		//#endregion
		//#region src/client/dock-labels.ts
		/** Clamp a 0–100 utilization for display, or undefined for display-only rows. */
		function dockUsedPercent(item) {
			if (typeof item.percent !== "number" || !Number.isFinite(item.percent)) return void 0;
			return Math.max(0, Math.min(100, Math.round(item.percent)));
		}
		/**
		* Bar/dot color for a used share. Parity with upstream `usageBarColor`:
		* success normally, warn from 80%, error from 95%. Every color resolves
		* through a `--dsw-*` design token.
		*/
		function dockUsageBarColor(percent) {
			if (percent >= 95) return "var(--dsw-alias-state-error-primary)";
			if (percent >= 80) return "var(--dsw-alias-state-warn-label)";
			return "var(--dsw-alias-state-success-primary)";
		}
		/** Split items into preview rows + overflow (upstream previewWindows parity). */
		function dockPreviewWindows(items) {
			const list = Array.isArray(items) ? items : [];
			return {
				shown: list.slice(0, 4),
				hidden: list.slice(4)
			};
		}
		/** Normalize a reset instant (ISO string or epoch ms/s) to epoch ms. */
		function dockResetParts(resetAt) {
			if (typeof resetAt === "number" && Number.isFinite(resetAt) && resetAt > 0) return { ms: resetAt < 0xe8d4a51000 ? resetAt * 1e3 : resetAt };
			if (typeof resetAt === "string" && resetAt !== "") {
				const ms = Date.parse(resetAt);
				return Number.isNaN(ms) ? void 0 : { ms };
			}
		}
		/**
		* Compact time-remaining label for one usage window: "6d18h" (days+hours),
		* "1h58m" (hours+minutes), or "42m" (minutes only). Falls back to the item
		* label (already "5h"/"7d"/"30d" on our rows) when no reset time is known.
		*/
		function dockWindowLabel(item, now = Date.now()) {
			const parsed = dockResetParts(item.resetAt);
			if (parsed === void 0) return item.label !== "" ? item.label : "W";
			const diff = Math.max(0, parsed.ms - now);
			const minutes = Math.floor(diff / 6e4);
			const hours = Math.floor(minutes / 60);
			const days = Math.floor(hours / 24);
			if (days > 0) return `${days}d${hours % 24}h`;
			if (hours > 0) return `${hours}h${minutes % 60}m`;
			return `${Math.max(1, minutes)}m`;
		}
		/**
		* Collapsed pill segment for one provider: "<Name> <win> <pct>%" for up to
		* two percent windows plus a "+n" overflow (mirrors upstream
		* `compactSegment`). Providers with no percent windows contribute their
		* bare label so an ok-but-windowless provider still reads in the pill.
		*/
		function dockCompactSegment(p, now = Date.now()) {
			const windows = (Array.isArray(p.items) ? p.items : []).filter((i) => dockUsedPercent(i) !== void 0);
			if (windows.length === 0) return p.label;
			const parts = windows.slice(0, 2).map((w) => `${dockWindowLabel(w, now)} ${(dockUsedPercent(w) ?? 0).toString()}%`);
			if (windows.length > 2) parts.push(`+${windows.length - 2}`);
			return `${p.label} ${parts.join(" · ")}`;
		}
		//#endregion
		//#region src/client/locale.ts
		/**
		* English-only locale strings for the overlay pill/ring + panel.
		*
		* @module dsh-subscription-overlay/client/locale
		*/
		const strings = {
			"pill.defaultName": "Subscriptions",
			"pill.title.default": "View subscription quotas (draggable)",
			"dock.title": "Subscription usage",
			"dock.moreWindows": "More quota windows ({count})",
			"pill.title.summary": "{summary} (draggable)",
			"ring.title.focus": "{label} · {item}: {percent}% left (hover pauses carousel, draggable)",
			"panel.title": "Subscriptions",
			"panel.normalCount": "{ok}/{total} OK",
			"panel.refresh": "Refresh",
			"panel.refreshing": "Refreshing…",
			"panel.empty": "No providers to show yet — enable providers on the settings page, check login state, then refresh.",
			"panel.footer.refreshedAt": "Refreshed at {time}",
			"panel.footer.never": "Not refreshed yet",
			"mode.toRing": "Switch to ring",
			"mode.toPill": "Switch to pill",
			"status.ok": "OK",
			"status.error": "Failed",
			"status.disabled": "Off",
			"status.loading": "Loading",
			"probe.run": "Probe",
			"probe.title": "Probe commandcode model-service availability (online/offline only, never a quota percent)",
			"probe.running": "Probing…",
			"probe.ok": "✓ online · {ms}ms · {n} models",
			"probe.okNoModels": "✓ online · {ms}ms",
			"probe.fail": "✗ {message}",
			"burn.title": "This month (local ledger)",
			"burn.used": "{used} / {budget} tokens logged locally",
			"burn.usedNoBudget": "{used} tokens logged this month (no budget set — see commandcode.ai for actual usage)",
			"burn.remaining": "{remaining} tokens remaining (estimated)",
			"burn.dashboardHint": "Real usage: commandcode.ai/settings/usage",
			"probe.state.online": "Model service online",
			"probe.state.offline": "Model service unavailable",
			"probe.state.unknown": "Not probed yet",
			"item.remaining": "{n} left",
			"reset.today": "resets today {time}",
			"reset.day": "resets {date} {time}",
			"error.readStatus": "Could not read the plugin state — reload the page",
			"error.requestFailed": "Plugin request failed (HTTP {status})"
		};
		/** Translate one key, interpolating {param} placeholders. */
		function translate(_lang, key, params) {
			let text = strings[key] ?? key;
			if (params) for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
			return text;
		}
		/** Always returns 'en' — kept for call-site compatibility. */
		function browserLang() {
			return "en";
		}
		//#endregion
		//#region src/client/DockBadge.tsx
		/**
		* Composer-dock badge replacing the subscriptions pill.
		*
		* Visual mirror of upstream `SubscriptionUsageBadge` (pixel-for-pixel chrome;
		* only the data source stays ours): collapsed pill `span > button` with the
		* stats icon + compact segments, portaled onto the host `[data-composer-stats]`
		* row with an in-place fallback, and a trigger-anchored `role="dialog"`
		* listing every provider with `dl`-grid window rows, flat usage bars, and a
		* 4-window preview + `<details>` overflow. No status dot, no gradients.
		*
		* Mount rules (the registration stays mounted; the component gates):
		* renders null while the plugin is disabled/hidden or while
		* `display !== 'dock'`; renders the invisible seat alone while no provider
		* reports usable windows (same as upstream).
		*
		* @module dsh-subscription-overlay/client/DockBadge
		*/
		/** Distance between the trigger's top edge and the dialog's bottom. */
		const PANEL_GAP = 8;
		/** Distance kept between the dialog and each viewport edge. */
		const PANEL_MARGIN = 12;
		/** The composer-dock quota badge + dialog entry. */
		function DockBadge(props) {
			const state = props.useSubscriptionOverlay((snapshot) => snapshot);
			const lang = browserLang();
			const t = (key, params) => translate(lang, key, params);
			const [open, setOpen] = (0, react.useState)(false);
			const [hover, setHover] = (0, react.useState)(false);
			const rootRef = (0, react.useRef)(null);
			const panelRef = (0, react.useRef)(null);
			const seatRef = (0, react.useRef)(null);
			const pos = (0, _deepseek_ai_dsh_client_ui_primitives.useAnchoredPosition)({
				open,
				anchorRef: rootRef,
				panelRef,
				side: "top",
				gap: PANEL_GAP,
				margin: PANEL_MARGIN
			});
			(0, _deepseek_ai_dsh_client_ui_primitives.useDismissOnOutsidePointer)(rootRef, open, setOpen, panelRef);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open]);
			const [statsRow, setStatsRow] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				const seat = seatRef.current;
				if (seat === null) return;
				const scope = statsScopeOf(seat);
				if (scope === null) return;
				const find = () => scope.querySelector("[data-composer-stats]");
				setStatsRow(find());
				const observer = new MutationObserver(() => {
					setStatsRow(find());
				});
				observer.observe(scope, {
					childList: true,
					subtree: true
				});
				return () => {
					observer.disconnect();
				};
			}, []);
			if (!state.visible || !state.enabled || state.display !== "dock") return null;
			const seat = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				ref: seatRef,
				style: upStyles.seat,
				"aria-hidden": "true"
			});
			const shown = state.providers.filter((p) => p.status === "ok" && (p.items ?? []).some((i) => dockUsedPercent(i) !== void 0));
			if (shown.length === 0) return seat;
			const label = shown.map((p) => dockCompactSegment(p)).join(" | ");
			const title = t("dock.title");
			const busy = state.busy;
			const toggle = () => {
				setOpen(!open);
			};
			const pill = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				ref: rootRef,
				style: upStyles.anchor,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					"data-dso-dock": "1",
					style: {
						...upStyles.pill,
						...hover || open ? upStyles.pillActive : {}
					},
					"aria-haspopup": "dialog",
					"aria-expanded": open,
					"aria-label": `${title} · ${label}`,
					title,
					onMouseEnter: () => {
						setHover(true);
					},
					onMouseLeave: () => {
						setHover(false);
					},
					onClick: toggle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDataOutline16, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: upStyles.label,
						children: label
					})]
				}), open && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: panelRef,
					role: "dialog",
					"aria-label": title,
					style: {
						...upStyles.panel,
						...pos ?? MEASURE_STYLE
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: upStyles.title,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: upStyles.titleLabel,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDataOutline16, {}), title]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: upStyles.refreshButton,
								disabled: busy,
								onClick: () => {
									props.refresh();
								},
								children: busy ? t("panel.refreshing") : t("panel.refresh")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: upStyles.titleRule,
							"aria-hidden": "true"
						}),
						state.providers.map((p, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DockProviderSection, {
							provider: p,
							first: index === 0,
							t
						}, p.id)),
						state.formError !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: upStyles.accountRow,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: upStyles.providerMeta,
								children: state.formError
							})
						})
					]
				}), document.body)]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [seat, statsRow !== null && statsRow.isConnected ? (0, react_dom.createPortal)(pill, statsRow) : pill] });
		}
		/**
		* Nearest ancestor of the dock seat that can contain the host's stats row:
		* the composer bar. Bounded so a badge in an unfamiliar layout never adopts
		* some other composer's pills.
		*/
		function statsScopeOf(seat) {
			let node = seat === null ? null : seat.parentElement;
			for (let depth = 0; node !== null && depth < 4; depth++) {
				if (node.querySelector("[data-composer-stats]") !== null) return node;
				node = node.parentElement;
			}
			return seat === null ? null : seat.parentElement;
		}
		/** One provider section: name row, message line, window rows with preview. */
		function DockProviderSection({ provider, first, t }) {
			const items = Array.isArray(provider.items) ? provider.items : [];
			const { shown, hidden } = dockPreviewWindows(items);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: first ? void 0 : upStyles.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: upStyles.providerRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: upStyles.providerName,
							children: provider.label
						}), provider.status !== "ok" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: upStyles.providerMeta,
							children: t(`status.${provider.status}`)
						})]
					}),
					provider.message != null && provider.message !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: upStyles.accountRow,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: upStyles.providerMeta,
							title: provider.message,
							children: provider.message
						})
					}),
					provider.status === "ok" && items.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
						style: upStyles.details,
						children: shown.map((item, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DockWindowRow, { item }, `${item.label}-${i}`))
					}), hidden.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						style: upStyles.moreWindows,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", {
							style: upStyles.moreSummary,
							children: t("dock.moreWindows", { count: hidden.length })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
							style: upStyles.details,
							children: hidden.map((item, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DockWindowRow, { item }, `${item.label}-${i}`))
						})]
					})] }),
					provider.status === "ok" && items.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: upStyles.accountRow,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: upStyles.providerMeta,
							children: t("panel.empty")
						})
					})
				]
			});
		}
		/** One `dt`/`dd` pair: window name → `25% · 6d1h`, with the bar underneath. */
		function DockWindowRow({ item }) {
			const percent = dockUsedPercent(item);
			const hasReset = dockResetParts(item.resetAt) !== void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
					style: upStyles.dt,
					children: item.label
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
					style: upStyles.dd,
					children: percent !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						percent,
						"%",
						hasReset && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: upStyles.reset,
							children: [" · ", dockWindowLabel(item)]
						})
					] }) : item.display ?? ""
				}),
				percent !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: upStyles.bar,
					"aria-hidden": "true",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: {
						...upStyles.barFill,
						width: `${String(percent)}%`,
						background: dockUsageBarColor(percent)
					} })
				})
			] });
		}
		/**
		* Unplaced portal panel: hidden but laid out so the clamp measures real
		* dimensions (the `useAnchoredPosition` measure pass).
		*/
		const MEASURE_STYLE = {
			visibility: "hidden",
			left: 0,
			top: 0
		};
		/**
		* Upstream-exact chrome (mirrors the host StatsPills pill and stat-dialog
		* panel): every color resolves through a `--dsw-*` design token, fills are
		* flat `usageBarColor` steps, no gradients, no custom classes.
		*/
		const upStyles = {
			seat: { display: "none" },
			anchor: {
				minWidth: 0,
				maxWidth: "100%",
				display: "inline-flex"
			},
			pill: {
				boxSizing: "border-box",
				maxWidth: "100%",
				color: "var(--dsw-alias-label-tertiary)",
				font: "inherit",
				fontSize: "var(--dsh-content-font-size-secondary, 13px)",
				fontVariantNumeric: "tabular-nums",
				lineHeight: "20px",
				whiteSpace: "nowrap",
				background: "transparent",
				border: "none",
				borderRadius: 24,
				alignItems: "center",
				gap: 6,
				padding: "1px 8px",
				display: "inline-flex",
				cursor: "pointer"
			},
			pillActive: {
				background: "var(--dsw-alias-interactive-bg-hover)",
				color: "var(--dsw-alias-label-secondary)"
			},
			label: {
				textOverflow: "ellipsis",
				minWidth: 0,
				overflow: "hidden"
			},
			panel: {
				position: "fixed",
				zIndex: 1100,
				boxSizing: "border-box",
				background: "var(--dsw-specific-menu)",
				width: "max-content",
				minWidth: "min(300px, 100vw - 24px)",
				maxWidth: "min(440px, 100vw - 24px)",
				maxHeight: "min(560px, 100dvh - 24px)",
				overflowY: "auto",
				overscrollBehavior: "contain",
				boxShadow: "var(--dsw-elevation-prominent)",
				color: "var(--dsw-alias-label-secondary)",
				cursor: "default",
				border: 0,
				borderRadius: 12,
				padding: 16,
				fontSize: 12,
				lineHeight: "18px"
			},
			title: {
				color: "var(--dsw-alias-label-primary)",
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				gap: 16,
				marginBottom: 8,
				fontWeight: 500
			},
			titleLabel: {
				alignItems: "center",
				gap: 6,
				minWidth: 0,
				display: "inline-flex"
			},
			titleRule: {
				borderTop: "0.5px solid var(--dsw-alias-border-l2)",
				marginBottom: 10
			},
			refreshButton: {
				background: "transparent",
				border: "none",
				cursor: "pointer",
				color: "var(--dsw-alias-label-secondary)",
				font: "inherit",
				fontSize: 12,
				padding: 0
			},
			section: {
				marginTop: 12,
				paddingTop: 10,
				borderTop: "0.5px solid var(--dsw-alias-border-l2)"
			},
			providerRow: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "baseline",
				gap: 16,
				marginBottom: 6
			},
			providerName: {
				color: "var(--dsw-alias-label-primary)",
				fontWeight: 500,
				display: "inline-flex",
				alignItems: "center",
				gap: 6
			},
			providerMeta: {
				color: "var(--dsw-alias-label-tertiary)",
				minWidth: 0,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			accountRow: {
				display: "flex",
				marginBottom: 4
			},
			details: {
				color: "var(--dsw-alias-label-tertiary)",
				display: "grid",
				gridTemplateColumns: "minmax(0, 1fr) max-content",
				gap: "4px 16px",
				margin: 0
			},
			moreWindows: { marginTop: 8 },
			moreSummary: {
				cursor: "pointer",
				color: "var(--dsw-alias-label-secondary)",
				marginBottom: 8
			},
			dt: {
				minWidth: 0,
				margin: 0,
				overflowWrap: "anywhere"
			},
			dd: {
				minWidth: 0,
				margin: 0,
				color: "var(--dsw-alias-label-secondary)",
				fontVariantNumeric: "tabular-nums",
				textAlign: "right"
			},
			reset: { color: "var(--dsw-alias-label-tertiary)" },
			bar: {
				gridColumn: "1 / -1",
				height: 4,
				borderRadius: 2,
				overflow: "hidden",
				background: "var(--dsw-alias-border-l2)",
				marginBottom: 2
			},
			barFill: {
				height: "100%",
				borderRadius: 2
			}
		};
		//#endregion
		//#region src/client/SubscriptionPanel.tsx
		/**
		* Toggleable shell.overlay pill/ring + 4-provider panel.
		*
		* Adapted from dsh-quota's QuotaPanel (SPIKE §1, `.dso-` scope): draggable
		* floater persisted (mode + position), alert badge, click toggles the panel
		* + alert color at the host threshold. Tolerant empty/error states.
		*
		* Acceptance-critical rules (SPIKE §6 amendments):
		* - commandcode now renders real quota items (5h window + weekly with
		*   reset timers, balance, plan, spend, tokens) — identical pattern to
		*   claude/codex/opencode-go. Probe line only appears after an explicit
		*   probe; "Not probed yet" placeholder removed.
		* - burn ledger remains but is supplementary below the items.
		* - Hidden toggle unmounts BOTH the pill/ring AND the panel (render null).
		*
		* @module dsh-subscription-overlay/client/SubscriptionPanel
		*/
		/** Pointer travel below this many px still counts as a click, not a drag. */
		const DRAG_THRESHOLD_PX = 5;
		/** Viewport margin kept around the floater while dragging/clamping. */
		const POS_MARGIN = 4;
		/** Ring geometry (SVG viewBox 46x46). */
		const RING_R = 19.5;
		const RING_C = 2 * Math.PI * RING_R;
		/** Carousel dwell per provider while the ring cycles. */
		const RING_CAROUSEL_MS = 4e3;
		/** Keep the floater fully inside the viewport. */
		function clampPos(p) {
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			return {
				...p,
				x: Math.min(Math.max(p.x, POS_MARGIN), Math.max(POS_MARGIN, vw - p.w - POS_MARGIN)),
				y: Math.min(Math.max(p.y, POS_MARGIN), Math.max(POS_MARGIN, vh - p.h - POS_MARGIN))
			};
		}
		/** Read the stored floater position; missing/corrupt falls back to the default corner. */
		function loadPos() {
			try {
				const raw = window.localStorage.getItem(POS_KEY);
				if (!raw) return null;
				const p = JSON.parse(raw);
				if (typeof p.x === "number" && typeof p.y === "number") return clampPos({
					x: p.x,
					y: p.y,
					w: p.w ?? 160,
					h: p.h ?? 36
				});
			} catch {}
			return null;
		}
		function loadMode() {
			try {
				return window.localStorage.getItem("dsh-subscription-overlay:mode") === "ring" ? "ring" : "pill";
			} catch {
				return "pill";
			}
		}
		function loadVisible() {
			try {
				return window.localStorage.getItem(VISIBLE_KEY) !== "0";
			} catch {
				return true;
			}
		}
		/** Pill dot color from the provider status set. */
		function dotClass(state) {
			if (state.providers.length === 0) return "dso-dot--idle";
			if (state.providers.some((p) => p.status === "ok")) return state.providers.some((p) => p.status !== "ok" && p.status !== "disabled") ? "dso-dot--warn" : "dso-dot--ok";
			return "dso-dot--err";
		}
		function badgeClass(status) {
			switch (status) {
				case "ok": return "dso-badge--ok";
				case "disabled": return "dso-badge--disabled";
				case "loading": return "dso-badge--loading";
				default: return "dso-badge--error";
			}
		}
		/** Bar fill color class from a 0-100 percent and the host alert threshold. */
		function fillClass(percent, alertPct) {
			if (percent >= alertPct) return "dso-item-fill--danger";
			if (percent >= 60) return "dso-item-fill--warn";
			return "dso-item-fill--ok";
		}
		/** Compact reset label; tolerates ISO strings and epoch ms. */
		function resetText(iso, t) {
			if (iso === void 0 || iso === null || iso === "") return "";
			const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
			if (Number.isNaN(d.getTime())) return "";
			const sameDay = d.toDateString() === (/* @__PURE__ */ new Date()).toDateString();
			const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			return sameDay ? t("reset.today", { time }) : t("reset.day", {
				date: `${d.getMonth() + 1}/${d.getDate()}`,
				time
			});
		}
		/** The pill + panel entry. */
		function SubscriptionPanel(props) {
			const state = props.useSubscriptionOverlay((snapshot) => snapshot);
			const lang = browserLang();
			const t = (key, params) => translate(lang, key, params);
			const busy = state.busy;
			const okCount = state.providers.filter((p) => p.status === "ok").length;
			const totalCount = state.providers.length;
			const [mode, setModeState] = (0, react.useState)(() => typeof window === "undefined" ? "pill" : loadMode());
			(0, react.useEffect)(() => {
				props.setMode(mode);
				props.setVisible(loadVisible());
				try {
					const saved = window.localStorage.getItem(DISPLAY_KEY);
					if (saved === "dock" || saved === "floater") props.setDisplay(saved);
				} catch {}
			}, []);
			const alerts = alertCount(state);
			const toggleMode = () => {
				const next = mode === "pill" ? "ring" : "pill";
				setModeState(next);
				props.setMode(next);
				try {
					window.localStorage.setItem(MODE_KEY, next);
				} catch {}
			};
			if (!state.visible) return null;
			if (state.display !== "floater") return null;
			const summary = state.providers.filter((p) => p.status === "ok").map((p) => summarizeProvider(p)).filter((s) => s !== "").slice(0, 2).join(" · ");
			const firstOk = state.providers.find((p) => p.status === "ok");
			const ringCandidates = state.providers.filter((p) => p.status === "ok" && headlineItem(p) !== void 0);
			const [carouselIdx, setCarouselIdx] = (0, react.useState)(0);
			const [ringHover, setRingHover] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (mode !== "ring" || ringHover || ringCandidates.length < 2) return;
				const timer = setInterval(() => {
					setCarouselIdx((i) => i + 1);
				}, RING_CAROUSEL_MS);
				return () => clearInterval(timer);
			}, [
				mode,
				ringHover,
				ringCandidates.length
			]);
			const ringFocus = ringCandidates[carouselIdx % Math.max(1, ringCandidates.length)];
			const ringItem = ringFocus ? headlineItem(ringFocus) : void 0;
			const ringPercent = ringItem?.percent;
			const ringRemaining = ringPercent !== void 0 ? Math.max(0, Math.min(100, 100 - ringPercent)) : void 0;
			const [pos, setPos] = (0, react.useState)(() => typeof window === "undefined" ? null : loadPos());
			const [dragging, setDragging] = (0, react.useState)(false);
			const pillRef = (0, react.useRef)(null);
			const dragRef = (0, react.useRef)(null);
			/** Drag end still fires a click on the pill — swallow exactly one. */
			const suppressClickRef = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				const measure = () => {
					const rect = pillRef.current?.getBoundingClientRect();
					if (!rect) return;
					setPos((p) => p ? clampPos({
						x: rect.left,
						y: rect.top,
						w: rect.width,
						h: rect.height
					}) : p);
				};
				measure();
				window.addEventListener("resize", measure);
				return () => {
					window.removeEventListener("resize", measure);
				};
			}, []);
			const onPillPointerDown = (e) => {
				if (e.button !== 0) return;
				const rect = e.currentTarget.getBoundingClientRect();
				const base = {
					x: rect.left,
					y: rect.top,
					w: rect.width,
					h: rect.height
				};
				dragRef.current = {
					pointerId: e.pointerId,
					startX: e.clientX,
					startY: e.clientY,
					base,
					latest: base,
					moved: false
				};
				e.currentTarget.setPointerCapture(e.pointerId);
			};
			const onPillPointerMove = (e) => {
				const d = dragRef.current;
				if (!d || e.pointerId !== d.pointerId) return;
				const dx = e.clientX - d.startX;
				const dy = e.clientY - d.startY;
				if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
				d.moved = true;
				setDragging(true);
				const next = clampPos({
					...d.base,
					x: d.base.x + dx,
					y: d.base.y + dy
				});
				d.latest = next;
				setPos(next);
			};
			const onPillPointerUp = (e) => {
				const d = dragRef.current;
				if (!d || e.pointerId !== d.pointerId) return;
				dragRef.current = null;
				setDragging(false);
				if (d.moved) {
					suppressClickRef.current = true;
					try {
						window.localStorage.setItem(POS_KEY, JSON.stringify(d.latest));
					} catch {}
				}
			};
			const flip = pos !== null && pos.y < window.innerHeight / 2;
			const rootStyle = pos === null ? void 0 : flip ? {
				left: pos.x,
				top: pos.y,
				right: "auto",
				bottom: "auto",
				alignItems: "flex-start"
			} : {
				right: window.innerWidth - pos.x - pos.w,
				bottom: window.innerHeight - pos.y - pos.h
			};
			const edge = pos !== null && !state.open ? pos.x <= 12 ? "l" : pos.x + pos.w >= window.innerWidth - 12 ? "r" : "" : "";
			const badge = alerts > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dso-alert",
				children: alerts > 99 ? "99+" : alerts
			}) : null;
			const dragHandlers = {
				onPointerDown: onPillPointerDown,
				onPointerMove: onPillPointerMove,
				onPointerUp: onPillPointerUp,
				onPointerCancel: onPillPointerUp,
				onClick: () => {
					if (suppressClickRef.current) {
						suppressClickRef.current = false;
						return;
					}
					props.toggle();
				}
			};
			const pill = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				ref: pillRef,
				type: "button",
				className: `dso-pill${dragging ? " dso-pill--dragging" : ""}${edge !== "" ? ` dso-floater--edge-${edge}` : ""}`,
				style: flip ? { order: -1 } : void 0,
				...dragHandlers,
				title: summary !== "" ? t("pill.title.summary", { summary }) : t("pill.title.default"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `dso-dot ${dotClass(state)}` }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dso-pill-name",
						children: firstOk?.label ?? t("pill.defaultName")
					}),
					summary !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dso-pill-model",
						children: summary
					}),
					badge
				]
			});
			const ring = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				ref: pillRef,
				type: "button",
				className: `dso-ring${dragging ? " dso-pill--dragging" : ""}${edge !== "" ? ` dso-floater--edge-${edge}` : ""}`,
				style: flip ? { order: -1 } : void 0,
				...dragHandlers,
				onPointerEnter: () => {
					setRingHover(true);
				},
				onPointerLeave: () => {
					setRingHover(false);
				},
				title: ringFocus && ringItem ? t("ring.title.focus", {
					label: ringFocus.label,
					item: ringItem.label,
					percent: Math.round(ringRemaining ?? 0)
				}) : t("pill.title.default"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
						viewBox: "0 0 46 46",
						className: "dso-ring-svg",
						"aria-hidden": "true",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							className: "dso-ring-track",
							cx: "23",
							cy: "23",
							r: RING_R
						}), ringRemaining !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							className: `dso-ring-arc ${ringPercent !== void 0 && ringPercent >= state.alertPct ? "dso-ring-arc--danger" : ringPercent !== void 0 && ringPercent >= 60 ? "dso-ring-arc--warn" : "dso-ring-arc--ok"}`,
							cx: "23",
							cy: "23",
							r: RING_R,
							transform: "rotate(-90 23 23)",
							strokeDasharray: RING_C,
							strokeDashoffset: RING_C * (1 - ringRemaining / 100)
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dso-ring-text",
						children: ringRemaining !== void 0 ? `${String(Math.round(ringRemaining))}%` : "—"
					}),
					badge
				]
			});
			const floater = mode === "ring" ? ring : pill;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dso-root",
				style: rootStyle,
				children: [state.open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dso-panel",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dso-panel-head",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dso-panel-title",
									children: t("panel.title")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										opacity: .6
									},
									children: totalCount > 0 ? t("panel.normalCount", {
										ok: okCount,
										total: totalCount
									}) : ""
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dso-btn dso-btn--ghost",
									title: mode === "pill" ? t("mode.toRing") : t("mode.toPill"),
									onClick: toggleMode,
									children: mode === "pill" ? "◯" : "▬"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dso-btn dso-btn--primary",
									disabled: busy,
									onClick: () => {
										props.refresh();
									},
									children: busy ? t("panel.refreshing") : t("panel.refresh")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dso-btn dso-btn--ghost",
									onClick: () => {
										props.close();
									},
									children: "✕"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dso-panel-body",
							children: [
								state.loaded && state.providers.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dso-empty",
									children: t("panel.empty")
								}),
								state.providers.map((p) => p.id === "commandcode" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CommandcodeCard, {
									provider: p,
									state,
									t
								}, p.id) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderCard, {
									provider: p,
									state,
									t
								}, p.id)),
								state.formError !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dso-provider-msg",
									style: { color: "#e74c3c" },
									children: state.formError
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dso-foot",
							children: state.refreshedAt > 0 ? t("panel.footer.refreshedAt", { time: new Date(state.refreshedAt).toLocaleString("en-US") }) : t("panel.footer.never")
						})
					]
				}), floater]
			});
		}
		function ProviderCard({ provider, state, t }) {
			const items = Array.isArray(provider.items) ? provider.items : [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dso-provider",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dso-provider-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dso-provider-name",
							children: provider.label
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: `dso-badge ${badgeClass(provider.status)}`,
							children: t(`status.${provider.status}`)
						})]
					}),
					provider.message != null && provider.message !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dso-provider-msg",
						children: provider.message
					}),
					provider.status === "ok" && items.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dso-items",
						children: items.map((item, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageRow, {
							item,
							alertPct: state.alertPct,
							t
						}, `${item.label}-${i}`))
					}),
					provider.status === "ok" && items.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dso-provider-msg",
						children: t("panel.empty")
					})
				]
			});
		}
		/**
		* CommandCode card: quota items (5h window/weekly with reset timers,
		* balance, plan, spend, tokens) plus optional probe diagnostics.
		*/
		function CommandcodeCard({ provider, t, state }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dso-provider",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dso-provider-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dso-provider-name",
							children: provider.label
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: `dso-badge ${badgeClass(provider.status)}`,
							children: t(`status.${provider.status}`)
						})]
					}),
					provider.message != null && provider.message !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dso-provider-msg",
						children: provider.message
					}),
					provider.status === "ok" && Array.isArray(provider.items) && provider.items.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dso-items",
						children: provider.items.map((item, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageRow, {
							item,
							alertPct: state.alertPct,
							t
						}, `${item.label}-${i}`))
					}),
					provider.status === "ok" && (!Array.isArray(provider.items) || provider.items.length === 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dso-provider-msg",
						children: t("panel.empty")
					})
				]
			});
		}
		function UsageRow({ item, alertPct, t }) {
			const percent = typeof item.percent === "number" ? Math.max(0, Math.min(100, item.percent)) : void 0;
			const value = item.display ?? (percent !== void 0 ? `${Math.round(percent * 10) / 10}%` : item.remaining !== void 0 ? t("item.remaining", { n: item.remaining }) : "");
			const reset = resetText(item.resetAt, t);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dso-item",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dso-item-label",
						title: item.label,
						children: item.label
					}),
					percent !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dso-item-bar",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: `dso-item-fill ${fillClass(percent, alertPct)}`,
							style: { width: `${String(percent)}%` }
						})
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dso-item-bar",
						style: { background: "transparent" }
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dso-item-value",
						children: value
					}),
					reset !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dso-item-reset",
						children: reset
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Required services (cordis fiber inject). */
		const inject = ["slots"];
		/** Plugin id — unique per plugin; the overlay layer composites registrations. */
		const PLUGIN_ID = "dsh-subscription-overlay";
		/** Hotkey toggling overlay visibility (no clash with quota's Ctrl+Shift+U/Y). */
		const HOTKEY = "Ctrl+Shift+S";
		/**
		* Mount the subscription pill/ring + panel into the frame-wide overlay layer
		* and the settings section page.
		*
		* Failure policy: mounting problems are logged, never thrown — the web shell
		* fails the whole boot when a plugin apply throws, and an external plugin
		* must not take the GUI down.
		*/
		function apply(ctx) {
			try {
				ctx.effect(() => injectStyles(), `${PLUGIN_ID}: styles`);
			} catch (error) {
				console.error(`[${PLUGIN_ID}] style inject failed`, error);
			}
			let controller;
			try {
				controller = new OverlayController();
			} catch (error) {
				console.error(`[${PLUGIN_ID}] controller init failed`, error);
				return;
			}
			try {
				ctx.effect(() => {
					const timer = setInterval(() => {
						try {
							controller.pollIfVisible();
						} catch (error) {
							console.error(`[${PLUGIN_ID}] poll failed`, error);
						}
					}, 6e4);
					controller.reload();
					return () => clearInterval(timer);
				}, `${PLUGIN_ID}: poll`);
			} catch (error) {
				console.error(`[${PLUGIN_ID}] poll effect failed`, error);
			}
			try {
				ctx.effect(() => {
					const onKey = (event) => {
						if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && (event.key === "S" || event.key === "s")) {
							event.preventDefault();
							setVisible(controller, !controller.store.getSnapshot().visible);
						}
					};
					window.addEventListener("keydown", onKey);
					return () => {
						window.removeEventListener("keydown", onKey);
					};
				}, `${PLUGIN_ID}: hotkey`);
			} catch (error) {
				console.error(`[${PLUGIN_ID}] hotkey effect failed`, error);
			}
			try {
				const off = controller.store.subscribe(() => {
					const snapshot = controller.store.getSnapshot();
					try {
						window.localStorage.setItem(VISIBLE_KEY, snapshot.enabled && snapshot.visible ? "1" : "0");
					} catch {}
				});
				ctx.effect(() => off, `${PLUGIN_ID}: visible mirror`);
			} catch (error) {
				console.error(`[${PLUGIN_ID}] visible mirror failed`, error);
			}
			try {
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: PLUGIN_ID,
					inject: () => controller.inject()
				}, SubscriptionPanel));
			} catch (error) {
				console.error(`[${PLUGIN_ID}] overlay slot registration failed`, error);
			}
			try {
				ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
					name: "conversation.composer.dock",
					id: "dso-dock-badge",
					order: 11,
					inject: () => controller.inject()
				}, DockBadge));
			} catch (error) {
				console.error(`[${PLUGIN_ID}] dock slot registration failed`, error);
			}
			try {
				const syncDockHide = () => {
					if (typeof document === "undefined") return;
					try {
						const snapshot = controller.store.getSnapshot();
						const want = snapshot.display === "dock" && snapshot.visible && snapshot.enabled;
						const selector = `style[data-plugin-css="${DOCK_HIDE_TAG_ID}"]`;
						const existing = document.querySelector(selector);
						if (want && existing === null) {
							const tag = document.createElement("style");
							tag.dataset["plugin"] = PLUGIN_ID;
							tag.dataset["pluginCss"] = DOCK_HIDE_TAG_ID;
							tag.textContent = DOCK_HIDE_CSS;
							document.head.appendChild(tag);
						} else if (!want && existing !== null) existing.remove();
					} catch (error) {
						console.error(`[${PLUGIN_ID}] dock-hide sync failed`, error);
					}
				};
				const offDockHide = controller.store.subscribe(() => {
					syncDockHide();
				});
				syncDockHide();
				ctx.effect(() => offDockHide, `${PLUGIN_ID}: dock-hide`);
			} catch (error) {
				console.error(`[${PLUGIN_ID}] dock-hide effect failed`, error);
			}
			try {
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: PLUGIN_ID,
					order: 56,
					label: () => "Subscription Overlay",
					inject: () => ({
						hooks: {},
						setOverlayVisible: (visible) => {
							setVisible(controller, visible);
						}
					})
				}, OverlaySettingsSection));
			} catch (error) {
				console.error(`[${PLUGIN_ID}] settings section registration failed`, error);
			}
		}
		/** Persist visibility in both the snapshot store and localStorage. */
		function setVisible(controller, visible) {
			try {
				window.localStorage.setItem(VISIBLE_KEY, visible ? "1" : "0");
			} catch {}
			try {
				controller.inject()["setVisible"](visible);
			} catch (error) {
				console.error(`[${PLUGIN_ID}] setVisible failed`, error);
			}
		}
		/** Inject the panel stylesheet; the returned cleanup removes it on unload. */
		function injectStyles() {
			return injectStyleTag(STYLE_TAG_ID, PANEL_CSS);
		}
		/** Inject one plugin stylesheet; the returned cleanup removes it on unload. */
		function injectStyleTag(tagId, css) {
			if (typeof document === "undefined") return () => void 0;
			if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return () => void 0;
			const tag = document.createElement("style");
			tag.dataset["plugin"] = PLUGIN_ID;
			tag.dataset["pluginCss"] = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
			return () => tag.remove();
		}
		//#endregion
		exports.PREF_KEYS = {
			MODE_KEY,
			POS_KEY,
			VISIBLE_KEY,
			DISPLAY_KEY,
			HOTKEY
		};
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map