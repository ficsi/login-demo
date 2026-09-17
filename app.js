"use strict";

/* =====================================================================
   AUTH FLOW PROTOTYPE
   1. Pure core   — config, validators, reducer. No DOM, fully testable.
   2. Effects     — timers, toast lifetime, persistence, URL hash.
   3. View        — renders the modal and the reviewer panel from state.
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. PURE CORE
   --------------------------------------------------------------------- */
const LOADING_MS = 1500;
const MAX_ATTEMPTS = 3;
const DEMO = {
  name: "Alex",
  email: "alex.morgan@example.com",
  password: "Copper2026",
  rejectedPassword: "Wrongpass1"
};

const FIELDS = {
  identifier: { label: "E-MAIL", type: "text", inputmode: "email", placeholder: "Enter e-mail or username", autocomplete: "username", kind: "identifier" },
  email: { label: "E-MAIL", type: "email", inputmode: "email", placeholder: "Enter e-mail", autocomplete: "email", kind: "email" },
  password: { label: "PASSWORD", type: "password", placeholder: "Enter password", autocomplete: "current-password", kind: "rules" },
  resetPassword: { label: "PASSWORD", type: "password", placeholder: "Enter password", autocomplete: "new-password", kind: "rules" },
  confirmPassword: { label: "CONFIRM NEW PASSWORD", type: "password", placeholder: "Confirm new password", autocomplete: "new-password", kind: "match", matches: "resetPassword" },
  oldPassword: { label: "OLD PASSWORD", type: "password", placeholder: "Enter old password", autocomplete: "current-password", kind: "rules" },
  newPassword: { label: "NEW PASSWORD", type: "password", placeholder: "Enter new password", autocomplete: "new-password", kind: "rules", hint: true },
  repeatPassword: { label: "REPEAT NEW PASSWORD", type: "password", placeholder: "Repeat new password", autocomplete: "new-password", kind: "rules-match", matches: "newPassword" }
};

/* kind: form = submits to the mock server · ack = CTA only acknowledges
   · info = no CTA. Screens marked `derived` are not in the .fig file;
   they reuse its success pattern to close the flow. */
const SCREENS = {
  login: {
    label: "Log in", group: "Log in",
    title: () => "Log in",
    copy: `Don’t have an account? <button type="button" class="inline-link" data-toast="Registration is outside the supplied authentication flow.">REGISTER NOW</button>`,
    fields: ["identifier", "password"], remember: true, social: true,
    cta: "LOG IN", kind: "form",
    footer: `<button class="plain-link" type="button" data-nav="recovery">Forgot your password?</button>`
  },
  welcome: {
    label: "Welcome back", group: "Log in",
    title: (s) => `Welcome back, ${accountName(s)}!`,
    copy: `Don’t have an account? <button type="button" class="inline-link" data-toast="Registration is outside the supplied authentication flow.">REGISTER NOW</button>`,
    fields: ["password"], cta: "LOG IN", kind: "form",
    footer: (s) => `<span class="stacked-note"><button class="plain-link" type="button" data-nav="recovery">Forgot your password?</button><br />Not ${accountName(s)}?<br /><button class="plain-link" type="button" data-action="forget">Log in with another account</button></span>`
  },
  "login-success": {
    label: "Login success", group: "Log in", derived: true,
    title: (s) => s.redirected ? "You’re all set" : `Welcome, ${accountName(s)}!`,
    copy: (s) => s.redirected
      ? "Your dashboard is open. This prototype ends here — log out to try the flow again."
      : `Logged in${s.session?.via ? ` with ${s.session.via}` : ""}. Redirecting you to your dashboard…`,
    fields: [], kind: "info", success: true, redirect: true,
    footer: (s) => s.redirected ? `<button class="plain-link" type="button" data-action="logout">Log out</button>` : ""
  },
  recovery: {
    label: "Password recovery", group: "Recovery",
    title: () => "Password recovery",
    copy: "Don’t worry, it happens. We’ll send you reset instructions",
    fields: ["email"], cta: "RESET PASSWORD", kind: "form",
    footer: `<span>Forgot your username? <button class="inline-link" type="button" data-nav="username">RECOVER IT</button></span>`
  },
  "recovery-sent": {
    label: "Recovery sent", group: "Recovery",
    title: () => "Password recovery",
    copy: "We have sent you a recovery link via e-mail. Not seeing the e-mail? Please check your spam, or wait a few minutes.",
    fields: [], kind: "info", success: true,
    footer: `<button class="plain-link" type="button" data-nav="new-password">Open the reset link (demo)</button>`
  },
  "new-password": {
    label: "New password", group: "Recovery",
    title: () => "New password", copy: "",
    fields: ["resetPassword", "confirmPassword"], cta: "RESET AND LOGIN", kind: "form", tall: true
  },
  username: {
    label: "Username recovery", group: "Recovery",
    title: () => "Username recovery",
    copy: "Fill in your e-mail address and we will send you your username via e-mail. Contact us via support if you need further help.",
    fields: ["email"], cta: "SEND LOGIN", kind: "form",
    footer: `<span>Check out our <button class="inline-link" type="button" data-toast="Live Chat would open here.">Live Chat</button></span>`
  },
  "username-sent": {
    label: "Username sent", group: "Recovery", derived: true,
    title: () => "Username recovery",
    copy: "We have sent your username via e-mail. Not seeing the e-mail? Please check your spam, or wait a few minutes.",
    fields: [], kind: "info", success: true,
    footer: `<button class="plain-link" type="button" data-nav="login">Back to log in</button>`
  },
  frozen: {
    label: "Account frozen", group: "Account",
    title: () => "Account frozen",
    copy: `Your account has been temporarily blocked because you exceeded the number of login attempts with the wrong password. Do not hesitate to contact us via <button type="button" class="inline-link" data-toast="Live Chat would open here.">Live Chat</button> in case of any questions or issues`,
    fields: [], cta: "OK", kind: "ack", next: "login"
  },
  "change-password": {
    label: "Change password", group: "Account",
    title: () => "Change password",
    copy: "Please create and enter your new password",
    fields: ["oldPassword", "newPassword", "repeatPassword"], cta: "SAVE", kind: "form", tall: true
  }
};

const resolveText = (value, state) => (typeof value === "function" ? value(state) : value || "");
const accountName = (s) => s.session?.name || s.remembered?.name || DEMO.name;

/* --- validators ------------------------------------------------------ */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const EMAIL_MESSAGE = "Email format incorrect. Please follow format ‘example@sub.domain’";

function passwordRules(value) {
  return [
    { ok: value.length >= 9, text: "Min 9 characters" },
    { ok: /\d/.test(value), text: "Min 1 number" },
    { ok: /[A-Z]/.test(value), text: "Min 1 uppercase character" },
    { ok: /[a-z]/.test(value), text: "Min 1 lowercase character" },
    { ok: !/\s/.test(value), text: "Spaces aren’t allowed" }
  ];
}

/** Returns { valid, lines: [{ ok, text }] } for one field. */
function validateField(key, values) {
  const def = FIELDS[key];
  const raw = values[key] || "";
  const value = def.type === "password" ? raw : raw.trim();
  const fail = (text) => ({ valid: false, lines: [{ ok: false, text }] });
  const pass = { valid: true, lines: [] };

  if (def.kind === "email") {
    if (!value) return fail("Enter your e-mail address");
    return EMAIL_RE.test(value) ? pass : fail(EMAIL_MESSAGE);
  }
  if (def.kind === "identifier") {
    if (!value) return fail("Enter your e-mail or username");
    if (value.includes("@")) return EMAIL_RE.test(value) ? pass : fail(EMAIL_MESSAGE);
    return USERNAME_RE.test(value) ? pass : fail("Username must be 3–32 characters: letters, numbers, dot, dash or underscore");
  }
  if (def.kind === "match") {
    return value && value === (values[def.matches] || "") ? pass : fail("✕ Passwords must match");
  }
  const rules = passwordRules(value);
  if (def.kind === "rules-match") rules.push({ ok: Boolean(value) && value === (values[def.matches] || ""), text: "Passwords must match" });
  const valid = rules.every((rule) => rule.ok);
  return { valid, lines: valid ? [] : rules.map((r) => ({ ok: r.ok, text: `${r.ok ? "✓" : "✕"} ${r.text}` })) };
}

function formErrors(state) {
  const out = {};
  for (const key of SCREENS[state.screen].fields) {
    if (state.touched[key]) out[key] = validateField(key, state.values);
  }
  return out;
}

const formValid = (state) => SCREENS[state.screen].fields.every((key) => validateField(key, state.values).valid);

/** After a rejected submit the CTA stays disabled until every field is valid. */
const ctaDisabled = (state) => state.status === "idle" && state.submitCount > 0 && !formValid(state);

/* --- state ----------------------------------------------------------- */
function initialState(patch = {}) {
  return {
    screen: "login",
    status: "idle",          // idle | loading
    pending: null,           // { kind: "form" | "social", provider?, hold? }
    values: {},
    touched: {},
    reveal: {},
    submitCount: 0,
    serverError: null,
    attempts: 0,
    remember: false,
    remembered: null,        // { name, identifier } once "Remember me" was used
    session: null,           // { name, identifier, via }
    redirected: false,
    closed: false,
    toast: null,             // { id, text }
    toastSeq: 0,
    preset: "default",
    viewport: "desktop",
    renderId: 0,
    ...patch
  };
}

function toScreen(state, screen, patch = {}) {
  return {
    ...state,
    screen,
    status: "idle",
    pending: null,
    values: {},
    touched: {},
    reveal: {},
    submitCount: 0,
    serverError: null,
    redirected: false,
    closed: false,
    preset: "default",
    renderId: state.renderId + 1,
    ...patch
  };
}

const withToast = (state, text) => ({ ...state, toast: { id: state.toastSeq + 1, text }, toastSeq: state.toastSeq + 1 });

const nameFrom = (identifier = "") => {
  const base = identifier.split("@")[0].split(/[._-]/)[0] || DEMO.name;
  return base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
};

function resolveSubmission(state) {
  const { screen, values, pending } = state;

  if (pending?.kind === "social") {
    const session = { name: DEMO.name, identifier: DEMO.email, via: pending.provider };
    return toScreen(state, "login-success", { session, remembered: state.remember ? session : state.remembered });
  }

  if (screen === "login" || screen === "welcome") {
    const identifier = screen === "welcome" ? (state.remembered?.identifier || DEMO.email) : values.identifier.trim();
    if (values.password === DEMO.rejectedPassword) {
      const attempts = state.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) return toScreen(state, "frozen", { attempts: 0 });
      const left = MAX_ATTEMPTS - attempts;
      return {
        ...state, status: "idle", pending: null, attempts,
        serverError: `Incorrect e-mail or password. ${left} ${left === 1 ? "attempt" : "attempts"} left before your account is frozen.`
      };
    }
    const session = { name: screen === "welcome" ? accountName(state) : nameFrom(identifier), identifier, via: null };
    const remembered = screen === "login" ? (state.remember ? session : null) : state.remembered;
    return toScreen(state, "login-success", { session, remembered, attempts: 0 });
  }
  if (screen === "recovery") return toScreen(state, "recovery-sent");
  if (screen === "username") return toScreen(state, "username-sent");
  if (screen === "new-password") return withToast(toScreen(state, "login"), "Password reset successfully. You can now log in.");
  if (screen === "change-password") return withToast(toScreen(state, "change-password"), "Your password has been updated.");
  return { ...state, status: "idle", pending: null };
}

/* Reviewer presets: fill each screen with representative data. */
const SAMPLE = {
  invalid: { identifier: "mail@gmail", email: "mail@gmail", password: "Q1", resetPassword: "Q1", confirmPassword: "Q2", oldPassword: "q1", newPassword: "short", repeatPassword: "shorts" },
  valid: { identifier: DEMO.email, email: DEMO.email, password: DEMO.password, resetPassword: DEMO.password, confirmPassword: DEMO.password, oldPassword: "OldCopper2025", newPassword: DEMO.password, repeatPassword: DEMO.password }
};

const pick = (source, keys) => Object.fromEntries(keys.map((k) => [k, source[k]]));
const allTouched = (keys) => Object.fromEntries(keys.map((k) => [k, true]));

const PRESETS = {
  default: { label: "Default", applies: () => true },
  filled: { label: "Filled", applies: (sc) => sc.fields.length > 0 },
  errors: { label: "Errors · CTA disabled", applies: (sc) => sc.fields.length > 0 },
  "server-error": { label: "Wrong password", applies: (sc, key) => key === "login" || key === "welcome" },
  loading: { label: "Loading (held)", applies: (sc) => sc.kind === "form" },
  success: { label: "Success", applies: (sc) => sc.kind !== "info" }
};

function applyPreset(state, preset, screen = state.screen) {
  const sc = SCREENS[screen];
  const keys = sc.fields;
  const base = toScreen(state, screen, { preset });
  const filled = { ...base, values: pick(SAMPLE.valid, keys), touched: allTouched(keys) };
  switch (preset) {
    case "filled": return filled;
    case "errors": return { ...base, values: pick(SAMPLE.invalid, keys), touched: allTouched(keys), submitCount: 1 };
    case "server-error": return { ...filled, values: { ...filled.values, password: DEMO.rejectedPassword }, attempts: 1, serverError: "Incorrect e-mail or password. 2 attempts left before your account is frozen." };
    case "loading": return sc.kind === "form" ? { ...filled, status: "loading", pending: { kind: "form", hold: true } } : base;
    case "success":
      if (sc.kind === "ack") return toScreen(state, sc.next);
      return sc.kind === "form" ? resolveSubmission({ ...filled, status: "loading", pending: { kind: "form" } }) : base;
    default: return base;
  }
}

function reducer(state, action) {
  switch (action.type) {
    case "NAVIGATE":
      return toScreen(state, action.screen);
    case "PRESET":
      return applyPreset(state, action.preset, action.screen);
    case "INPUT":
      if (state.status === "loading") return state;
      return { ...state, values: { ...state.values, [action.key]: action.value }, touched: { ...state.touched, [action.key]: true }, serverError: null, preset: "default" };
    case "BLUR":
      return state.values[action.key] ? { ...state, touched: { ...state.touched, [action.key]: true } } : state;
    case "TOGGLE_REVEAL":
      return { ...state, reveal: { ...state.reveal, [action.key]: !state.reveal[action.key] } };
    case "TOGGLE_REMEMBER":
      return { ...state, remember: !state.remember };
    case "SUBMIT": {
      const sc = SCREENS[state.screen];
      if (state.status === "loading" || state.closed) return state;
      if (sc.kind === "ack") return toScreen(state, sc.next);
      if (sc.kind !== "form") return state;
      const touched = allTouched(sc.fields);
      state = { ...state, preset: "default" };
      if (!formValid(state)) return { ...state, touched, submitCount: state.submitCount + 1, serverError: null };
      return { ...state, touched, submitCount: state.submitCount + 1, serverError: null, status: "loading", pending: { kind: "form" } };
    }
    case "SOCIAL":
      if (state.status === "loading") return state;
      return { ...state, status: "loading", pending: { kind: "social", provider: action.provider }, serverError: null };
    case "RESOLVE":
      return state.status === "loading" ? resolveSubmission(state) : state;
    case "REDIRECTED":
      return state.screen === "login-success" ? { ...state, redirected: true } : state;
    case "LOGOUT":
      return toScreen(state, state.remembered ? "welcome" : "login", { session: null, remember: Boolean(state.remembered) });
    case "FORGET_ACCOUNT":
      return toScreen(state, "login", { remembered: null, remember: false, session: null });
    case "CLOSE":
      return { ...state, closed: true, status: "idle", pending: null };
    case "OPEN":
      return { ...state, closed: false };
    case "TOAST":
      return withToast(state, action.text);
    case "TOAST_DONE":
      return state.toast?.id === action.id ? { ...state, toast: null } : state;
    case "VIEWPORT":
      return { ...state, viewport: action.viewport };
    default:
      return state;
  }
}

/* --- URL hash (deep links) ------------------------------------------ */
function parseHash(hash) {
  const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  const screen = SCREENS[params.get("screen")] ? params.get("screen") : null;
  const preset = PRESETS[params.get("state")] ? params.get("state") : null;
  const viewport = ["desktop", "tablet", "mobile"].includes(params.get("vp")) ? params.get("vp") : null;
  return { screen, preset, viewport };
}

function serializeHash(state) {
  const params = new URLSearchParams({ screen: state.screen });
  if (state.preset !== "default") params.set("state", state.preset);
  if (state.viewport !== "desktop") params.set("vp", state.viewport);
  return `#${params}`;
}

/* --- self-tests (run from the reviewer panel) ----------------------- */
function runSelfTests() {
  const results = [];
  const test = (name, fn) => {
    try { results.push({ name, ok: fn() === true }); } catch (error) { results.push({ name, ok: false, error: error.message }); }
  };
  const run = (state, ...actions) => actions.reduce(reducer, state);
  const loginWith = (identifier, password, patch) => ({ ...initialState(patch), values: { identifier, password } });

  test("E-mail validator accepts name@domain.tld", () => validateField("email", { email: "a@b.co" }).valid);
  test("E-mail validator rejects mail@gmail", () => !validateField("email", { email: "mail@gmail" }).valid);
  test("Login accepts a username", () => validateField("identifier", { identifier: "alex_m" }).valid);
  test("Login rejects a 2-character username", () => !validateField("identifier", { identifier: "al" }).valid);
  test("Password rules pass for Copper2026", () => validateField("password", { password: "Copper2026" }).valid);
  test("Password rules require an uppercase letter", () => !validateField("password", { password: "copper2026" }).valid);
  test("Password rules reject spaces", () => !validateField("password", { password: "Copper 2026" }).valid);
  test("Confirm field must match", () => !validateField("confirmPassword", { resetPassword: "Copper2026", confirmPassword: "Copper2027" }).valid);
  test("Empty submit shows errors and disables the CTA", () => {
    const s = run(initialState(), { type: "SUBMIT" });
    return s.status === "idle" && s.touched.identifier && ctaDisabled(s);
  });
  test("Valid submit enters loading", () => run(loginWith(DEMO.email, DEMO.password), { type: "SUBMIT" }).status === "loading");
  test("Resolved login shows the success screen", () => run(loginWith(DEMO.email, DEMO.password), { type: "SUBMIT" }, { type: "RESOLVE" }).screen === "login-success");
  test("Three wrong passwords freeze the account", () => {
    let s = loginWith(DEMO.email, DEMO.rejectedPassword);
    for (let i = 0; i < 3; i += 1) s = run({ ...s, values: { identifier: DEMO.email, password: DEMO.rejectedPassword } }, { type: "SUBMIT" }, { type: "RESOLVE" });
    return s.screen === "frozen";
  });
  test("Remember me leads to Welcome back after logout", () => {
    const s = run(loginWith("jamie@example.com", DEMO.password, { remember: true }), { type: "SUBMIT" }, { type: "RESOLVE" }, { type: "LOGOUT" });
    return s.screen === "welcome" && accountName(s) === "Jamie";
  });
  test("Recovery request shows the confirmation", () => run({ ...initialState({ screen: "recovery" }), values: { email: DEMO.email } }, { type: "SUBMIT" }, { type: "RESOLVE" }).screen === "recovery-sent");
  test("Navigation clears form values", () => Object.keys(run(loginWith("x", "y"), { type: "NAVIGATE", screen: "recovery" }).values).length === 0);
  test("Deep link round-trips", () => {
    const parsed = parseHash(serializeHash(initialState({ screen: "frozen", preset: "success", viewport: "mobile" })));
    return parsed.screen === "frozen" && parsed.preset === "success" && parsed.viewport === "mobile";
  });
  return results;
}

window.AuthCore = { SCREENS, FIELDS, PRESETS, validateField, passwordRules, reducer, initialState, applyPreset, parseHash, serializeHash, runSelfTests };

/* ---------------------------------------------------------------------
   2 + 3. STORE, EFFECTS, VIEW
   --------------------------------------------------------------------- */
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const el = {
  stage: $("#stage"),
  modal: $("#auth-modal"),
  content: $("#modal-content"),
  form: $("#auth-form"),
  fieldset: $("#form-fieldset"),
  title: $("#screen-title"),
  copy: $("#screen-copy"),
  status: $("#status-block"),
  fields: $("#form-fields"),
  extras: $("#form-extras"),
  alert: $("#form-alert"),
  submit: $("#submit-button"),
  submitLabel: $("#submit-label"),
  social: $("#social-login"),
  footer: $("#footer-actions"),
  reopen: $("#reopen-button"),
  toast: $("#toast"),
  viewport: $("#demo-viewport"),
  viewportLabel: $("#viewport-label"),
  panel: $("#showcase-panel"),
  trigger: $("#showcase-trigger"),
  screenGrid: $("#screen-grid"),
  presetGrid: $("#preset-grid"),
  presetScreen: $("#preset-screen"),
  inspector: $("#state-inspector"),
  testsButton: $("#run-tests"),
  testsOutput: $("#test-results"),
  holdBanner: $("#hold-banner")
};

const STORAGE_KEY = "auth-demo:remembered";
const storage = {
  read() { try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY)); } catch { return null; } },
  write(value) { try { value ? window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) : window.localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ } }
};

let state;
const getState = () => state;
let renderedId = -1;
let lastSubmitCount = 0;
const timers = {};

function dispatch(action) {
  const prev = state;
  state = reducer(state, action);
  if (state === prev) return;
  render(prev, state);
  effects(prev, state);
}

/* --- effects --------------------------------------------------------- */
function effects(prev, next) {
  const startedLoading = next.status === "loading" && (prev.status !== "loading" || prev.pending !== next.pending);
  if (next.status !== "loading" || startedLoading) clearTimeout(timers.loading);
  if (startedLoading && !next.pending?.hold) timers.loading = setTimeout(() => dispatch({ type: "RESOLVE" }), LOADING_MS);

  if (next.toast && next.toast.id !== prev.toast?.id) {
    clearTimeout(timers.toast);
    const { id } = next.toast;
    timers.toast = setTimeout(() => dispatch({ type: "TOAST_DONE", id }), 3600);
  }

  const enteredSuccess = next.screen === "login-success" && next.renderId !== prev.renderId;
  if (next.screen !== "login-success" || enteredSuccess) clearTimeout(timers.redirect);
  if (enteredSuccess && !next.redirected) timers.redirect = setTimeout(() => dispatch({ type: "REDIRECTED" }), 2600);

  if (next.remembered !== prev.remembered) storage.write(next.remembered);

  const hash = serializeHash(next);
  if (hash !== window.location.hash) {
    try { window.history.replaceState(null, "", hash); } catch { /* sandboxed frame */ }
  }
}

/* --- view: modal ----------------------------------------------------- */
function fieldMarkup(key, state) {
  const def = FIELDS[key];
  const isPassword = def.type === "password";
  const value = escapeHtml(state.values[key] || "");
  const hint = def.hint ? `<p class="password-hint" id="${key}-hint">At least 1 uppercase character, 1 number, 1 lowercase character, minimum 9 symbols</p>` : "";
  return `
    <div class="field" data-field="${key}">
      <label class="field-label" for="${key}">${def.label}</label>
      <div class="input-shell">
        <input id="${key}" name="${key}" type="${def.type}" value="${value}" placeholder="${def.placeholder}"
          autocomplete="${def.autocomplete}" ${def.inputmode ? `inputmode="${def.inputmode}"` : ""}
          autocapitalize="off" spellcheck="false" aria-describedby="${key}-message${def.hint ? ` ${key}-hint` : ""}" />
        ${isPassword ? `<button class="eye-button" type="button" data-reveal="${key}" aria-controls="${key}" aria-pressed="false" aria-label="Show ${def.label.toLowerCase()}"><img src="assets/close-eye.svg" alt="" /></button>` : ""}
      </div>
      <p class="field-message" id="${key}-message" aria-live="polite"></p>
    </div>
    ${hint}`;
}

function renderScreen(state, animate) {
  const sc = SCREENS[state.screen];
  const paint = () => {
    el.modal.dataset.screen = state.screen;
    el.modal.classList.toggle("is-tall", Boolean(sc.tall));
    el.modal.classList.toggle("is-success", Boolean(sc.success));
    el.title.textContent = sc.title(state);
    el.copy.innerHTML = resolveText(sc.copy, state);
    el.fields.innerHTML = sc.fields.map((key) => fieldMarkup(key, state)).join("");
    el.form.hidden = Boolean(sc.success);
    el.submit.hidden = !sc.cta;
    el.submitLabel.textContent = sc.cta || "";
    el.extras.hidden = !sc.remember;
    el.social.hidden = !sc.social;
    el.status.hidden = !sc.success;
    el.status.innerHTML = sc.success
      ? `<img class="status-icon" src="assets/notification-success.png" alt="" />${sc.redirect ? `<div class="redirect-bar" role="progressbar" aria-label="Redirecting"><span></span></div>` : ""}`
      : "";
    const footer = resolveText(sc.footer, state);
    el.footer.innerHTML = footer;
    el.footer.hidden = !footer;
    patch(getState());
    el.content.classList.remove("is-changing");
  };

  if (!animate || reducedMotion()) return paint();
  el.content.classList.add("is-changing");
  clearTimeout(timers.paint);
  timers.paint = setTimeout(() => {
    paint();
    const focusTarget = $("input", el.fields) || el.title;
    focusTarget.focus({ preventScroll: true });
  }, 140);
}

function patch(state) {
  const sc = SCREENS[state.screen];
  const loading = state.status === "loading";
  const errors = formErrors(state);

  for (const key of sc.fields) {
    const wrap = $(`[data-field="${key}"]`, el.fields);
    const input = $(`#${key}`, el.fields);
    if (!wrap || !input) continue;
    const result = errors[key];
    const invalid = Boolean(result && !result.valid);
    wrap.classList.toggle("invalid", invalid);
    wrap.classList.toggle("valid", Boolean(result?.valid && state.values[key]));
    input.setAttribute("aria-invalid", String(invalid));
    if (input.value !== (state.values[key] || "")) input.value = state.values[key] || "";
    const lines = invalid ? result.lines : [];
    $(`#${key}-message`, el.fields).innerHTML = lines.map((l) => `<span class="${l.ok ? "rule-ok" : ""}">${escapeHtml(l.text)}</span>`).join("");
    const reveal = $(`[data-reveal="${key}"]`, el.fields);
    if (reveal) {
      const shown = Boolean(state.reveal[key]);
      input.type = shown ? "text" : "password";
      reveal.classList.toggle("is-visible", shown);
      reveal.setAttribute("aria-pressed", String(shown));
      reveal.setAttribute("aria-label", `${shown ? "Hide" : "Show"} ${FIELDS[key].label.toLowerCase()}`);
    }
  }

  if (state.submitCount > lastSubmitCount) {
    $$(".field.invalid", el.fields).forEach((wrap) => {
      wrap.classList.remove("shake");
      void wrap.offsetWidth;
      wrap.classList.add("shake");
    });
  }
  lastSubmitCount = state.submitCount;

  el.alert.textContent = state.serverError || "";
  el.alert.hidden = !state.serverError;

  const formLoading = loading && state.pending?.kind === "form";
  const disabled = ctaDisabled(state);
  el.fieldset.disabled = loading;
  el.submit.classList.toggle("loading", formLoading);
  el.submit.classList.toggle("is-disabled", disabled);
  el.submit.disabled = loading || disabled;
  el.submit.setAttribute("aria-busy", String(formLoading));
  el.submitLabel.textContent = sc.cta || "";

  const remember = $("#remember-me");
  remember.checked = state.remember;
  $$("[data-provider]", el.social).forEach((button) => {
    const busy = loading && state.pending?.provider === button.dataset.provider;
    button.classList.toggle("loading", busy);
    button.setAttribute("aria-busy", String(busy));
  });

  if (sc.redirect) {
    el.title.textContent = sc.title(state);
    el.copy.innerHTML = resolveText(sc.copy, state);
    const footer = resolveText(sc.footer, state);
    el.footer.innerHTML = footer;
    el.footer.hidden = !footer;
    el.status.classList.toggle("is-done", state.redirected);
  }
}

function render(prev, next) {
  if (next.renderId !== renderedId) {
    renderScreen(next, renderedId !== -1 && prev.screen !== next.screen);
    renderedId = next.renderId;
    lastSubmitCount = next.submitCount;
    if (next.submitCount > 0) lastSubmitCount = 0;
  }
  patch(next);

  el.modal.classList.toggle("is-hidden", next.closed);
  el.modal.setAttribute("aria-hidden", String(next.closed));
  el.reopen.hidden = !next.closed;

  if (next.toast?.id !== prev?.toast?.id || !next.toast) {
    if (next.toast) el.toast.textContent = next.toast.text;
    el.toast.classList.toggle("visible", Boolean(next.toast));
  }

  el.viewport.dataset.size = next.viewport;
  el.viewportLabel.textContent = { desktop: "", tablet: "Tablet · 768 px", mobile: "Mobile · 375 px" }[next.viewport];

  renderPanel(next);
}

/* --- view: reviewer panel -------------------------------------------- */
function buildPanel() {
  const groups = {};
  for (const [key, sc] of Object.entries(SCREENS)) (groups[sc.group] ||= []).push([key, sc]);
  el.screenGrid.innerHTML = Object.entries(groups).map(([group, items]) => `
    <div class="screen-group">
      <span class="screen-group-label">${group}</span>
      ${items.map(([key, sc]) => `<button type="button" data-screen="${key}">${sc.label}${sc.derived ? `<small title="Not in the .fig — closes the flow">added</small>` : ""}</button>`).join("")}
    </div>`).join("");
  el.presetScreen.innerHTML = Object.entries(SCREENS).map(([key, sc]) => `<option value="${key}">${sc.label}</option>`).join("");
  el.presetGrid.innerHTML = Object.entries(PRESETS).map(([key, p]) => `<button type="button" data-preset="${key}">${p.label}</button>`).join("");
}

function renderPanel(state) {
  const sc = SCREENS[state.screen];
  $$("[data-screen]", el.screenGrid).forEach((b) => b.classList.toggle("active", b.dataset.screen === state.screen));
  if (el.presetScreen.value !== state.screen) el.presetScreen.value = state.screen;
  $$("[data-preset]", el.presetGrid).forEach((b) => {
    const available = PRESETS[b.dataset.preset].applies(sc, state.screen);
    b.disabled = !available;
    b.classList.toggle("active", available && b.dataset.preset === state.preset);
  });
  $$("[data-viewport]").forEach((b) => b.classList.toggle("active", b.dataset.viewport === state.viewport));
  el.holdBanner.hidden = !(state.status === "loading" && state.pending?.hold);

  const snapshot = {
    screen: state.screen,
    status: state.status,
    pending: state.pending,
    values: Object.fromEntries(Object.entries(state.values).map(([k, v]) => [k, FIELDS[k].type === "password" && !state.reveal[k] ? "•".repeat(v.length) : v])),
    valid: Object.fromEntries(sc.fields.map((k) => [k, validateField(k, state.values).valid])),
    ctaDisabled: ctaDisabled(state),
    submitCount: state.submitCount,
    attempts: state.attempts,
    serverError: state.serverError,
    remember: state.remember,
    remembered: state.remembered,
    session: state.session,
    viewport: state.viewport
  };
  el.inspector.textContent = JSON.stringify(snapshot, null, 2);
}

function setPanel(open) {
  el.panel.classList.toggle("open", open);
  el.panel.setAttribute("aria-hidden", String(!open));
  el.panel.inert = !open;
  el.trigger.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("panel-open", open);
}

/* --- events ---------------------------------------------------------- */
el.form.addEventListener("submit", (event) => {
  event.preventDefault();
  dispatch({ type: "SUBMIT" });
});

el.form.addEventListener("input", (event) => {
  const { name, value } = event.target;
  if (event.target.id === "remember-me") return;
  if (FIELDS[name]) dispatch({ type: "INPUT", key: name, value });
});

el.form.addEventListener("focusout", (event) => {
  if (FIELDS[event.target.name]) dispatch({ type: "BLUR", key: event.target.name });
});

$("#remember-me").addEventListener("change", () => dispatch({ type: "TOGGLE_REMEMBER" }));

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  const { nav, toast, reveal, action, provider, screen, preset, viewport } = target.dataset;
  if (nav) dispatch({ type: "NAVIGATE", screen: nav });
  if (toast) dispatch({ type: "TOAST", text: toast });
  if (reveal) dispatch({ type: "TOGGLE_REVEAL", key: reveal });
  if (provider) dispatch({ type: "SOCIAL", provider });
  if (action === "logout") dispatch({ type: "LOGOUT" });
  if (action === "forget") dispatch({ type: "FORGET_ACCOUNT" });
  if (action === "resolve") dispatch({ type: "RESOLVE" });
  if (screen) {
    dispatch({ type: "NAVIGATE", screen });
    if (!document.body.classList.contains("panel-docked")) setPanel(false);
  }
  if (preset) {
    dispatch({ type: "PRESET", preset, screen: el.presetScreen.value });
    if (!document.body.classList.contains("panel-docked")) setPanel(false);
  }
  if (viewport) dispatch({ type: "VIEWPORT", viewport });
});

el.presetScreen.addEventListener("change", () => dispatch({ type: "NAVIGATE", screen: el.presetScreen.value }));

$("#close-button").addEventListener("click", () => dispatch({ type: "CLOSE" }));
el.reopen.addEventListener("click", () => {
  dispatch({ type: "OPEN" });
  $("input", el.fields)?.focus({ preventScroll: true });
});

el.trigger.addEventListener("click", () => setPanel(!el.panel.classList.contains("open")));
$("#panel-close").addEventListener("click", () => setPanel(false));

document.addEventListener("keydown", (event) => {
  const typing = event.target.matches?.("input, select, textarea");
  if (event.key === "Escape") {
    if (el.panel.classList.contains("open") && !document.body.classList.contains("panel-docked")) setPanel(false);
    else if (!state.closed) dispatch({ type: "CLOSE" });
  }
  if (!typing && (event.key === "`" || event.key === "~")) setPanel(!el.panel.classList.contains("open"));
});

el.testsButton.addEventListener("click", () => {
  const results = runSelfTests();
  const passed = results.filter((r) => r.ok).length;
  el.testsOutput.hidden = false;
  el.testsOutput.innerHTML = `
    <p class="tests-summary ${passed === results.length ? "pass" : "fail"}">${passed}/${results.length} checks passed</p>
    <ul>${results.map((r) => `<li class="${r.ok ? "pass" : "fail"}">${r.ok ? "✓" : "✕"} ${escapeHtml(r.name)}${r.error ? ` — ${escapeHtml(r.error)}` : ""}</li>`).join("")}</ul>`;
});

/* Ripple on the copper CTA. */
el.submit.addEventListener("pointerdown", (event) => {
  if (el.submit.disabled || reducedMotion()) return;
  const rect = el.submit.getBoundingClientRect();
  const ripple = document.createElement("span");
  ripple.className = "btn-ripple";
  ripple.style.left = `${event.clientX - rect.left}px`;
  ripple.style.top = `${event.clientY - rect.top}px`;
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  $(".btn-fx", el.submit).append(ripple);
});

/* Dock the panel beside the stage on wide screens. */
const wide = window.matchMedia("(min-width: 1180px)");
function syncDock() {
  document.body.classList.toggle("panel-docked", wide.matches);
  setPanel(wide.matches);
}
wide.addEventListener("change", syncDock);

/* --- boot ------------------------------------------------------------ */
function boot() {
  buildPanel();
  const remembered = storage.read();
  const link = parseHash(window.location.hash);
  const startScreen = link.screen || (remembered ? "welcome" : "login");
  state = initialState({ remembered, remember: Boolean(remembered), viewport: link.viewport || "desktop" });
  state = link.preset ? applyPreset(state, link.preset, startScreen) : toScreen(state, startScreen);
  render(null, state);
  effects(initialState(), state);
  syncDock();
}

window.addEventListener("hashchange", () => {
  const link = parseHash(window.location.hash);
  if (link.screen && (link.screen !== state.screen || (link.preset || "default") !== state.preset)) {
    dispatch({ type: "PRESET", preset: link.preset || "default", screen: link.screen });
  }
});

boot();
