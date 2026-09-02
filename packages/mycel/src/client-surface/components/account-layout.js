import { authKey, regionKey } from "./account-services.js";

const CSS = `
  :root {
    --bg: #07100c; --panel: #0b1710; --line: rgba(209,233,200,.14);
    --ink: #edf4ed; --muted: #839187; --accent: #c7f4aa; --error: #ffc4b5;
    --serif: Georgia, 'Times New Roman', serif;
    --mono: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  }
  body.account-surface { background: var(--bg); color: var(--ink); font-family: Arial, sans-serif; }
  body.account-surface > header {
    position: sticky; top: 0; z-index: 10; min-height: 72px; padding: 0 4vw;
    align-items: center; background: rgba(7,16,12,.9); backdrop-filter: blur(18px);
  }
  .account-brand { color: var(--ink); text-decoration: none; font: 600 18px/1 var(--mono); }
  .account-brand::before { content: '●'; margin-right: 10px; color: var(--accent); }
  .account-nav { display: flex; align-items: center; gap: 20px; margin-left: auto; }
  .account-nav a { color: var(--muted); text-decoration: none; font: 10px/1 var(--mono); text-transform: uppercase; letter-spacing: .08em; }
  .account-nav a[aria-current] { color: var(--accent); }
  .account-auth-controls { display: flex; align-items: center; gap: 9px; }
  body.account-surface main#region {
    width: min(1180px, 92vw); margin: 0 auto; padding: 64px 0 100px;
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px;
  }
  body.account-surface #shell-status { width: min(1180px, 92vw); margin: 0 auto; padding: 0 0 25px; }
  .account-card { border: 1px solid var(--line); background: rgba(255,255,255,.016); min-width: 0; }
  .account-card[data-component='account-overview'],
  .account-card[data-component='account-applications'],
  .account-card[data-component='account-usage'] { grid-column: 1 / -1; }
  .account-card > header { min-height: 78px; display: flex; align-items: center; gap: 14px; padding: 18px 22px; border-bottom: 1px solid var(--line); }
  .account-card > header span { color: #63746a; font: 9px/1 var(--mono); }
  .account-card > header h2 { margin: 0; color: var(--ink); font: 400 27px/1 var(--serif); text-transform: none; letter-spacing: -.02em; }
  .account-card-body { padding: 22px; }
  .account-hero { display: flex; justify-content: space-between; align-items: end; gap: 30px; padding: clamp(18px,4vw,48px) 0; }
  .account-hero h1 { margin: 8px 0 0; font: 400 clamp(44px,6vw,76px)/.95 var(--serif); letter-spacing: -.05em; }
  .account-kicker { color: var(--accent); font: 9px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; }
  .account-vitals { display: grid; grid-template-columns: repeat(2,minmax(150px,1fr)); border: 1px solid var(--line); }
  .account-vitals div { padding: 18px 22px; }
  .account-vitals div + div { border-left: 1px solid var(--line); }
  .account-vitals span, .account-vitals strong { display: block; }
  .account-vitals span { margin-bottom: 10px; color: var(--muted); font: 9px/1 var(--mono); text-transform: uppercase; }
  .account-vitals strong { color: var(--accent); font: 20px/1 var(--mono); }
  .account-gate { max-width: 720px; padding: 35px 0; }
  .account-gate h1 { margin: 0 0 20px; font: 400 clamp(45px,7vw,76px)/.95 var(--serif); }
  .account-gate p, .account-note, .account-empty { color: var(--muted); line-height: 1.65; }
  .account-actions, .account-row-actions, .account-inline { display: flex; gap: 9px; flex-wrap: wrap; align-items: center; }
  .account-button { padding: 11px 14px; border: 1px solid rgba(209,233,200,.22); color: #c8d4cb; background: transparent; cursor: pointer; font: 9px/1 var(--mono); letter-spacing: .06em; text-transform: uppercase; }
  .account-button.primary { color: var(--bg); border-color: var(--accent); background: var(--accent); }
  .account-button.danger { color: var(--error); border-color: rgba(255,155,130,.3); }
  .account-button:disabled { opacity: .45; cursor: not-allowed; }
  .account-form { display: grid; gap: 16px; max-width: 620px; }
  .account-form.two { grid-template-columns: 1fr 1fr auto; align-items: end; }
  .account-form label { display: grid; gap: 8px; color: var(--muted); font: 9px/1 var(--mono); text-transform: uppercase; letter-spacing: .08em; }
  .account-form input { min-width: 0; width: 100%; padding: 13px 14px; border: 1px solid rgba(209,233,200,.22); outline: none; color: var(--ink); background: rgba(3,9,6,.55); font: 14px/1.2 Arial,sans-serif; }
  .account-form input:focus { border-color: var(--accent); }
  .account-list { margin: 0; padding: 0; list-style: none; }
  .account-list li { min-height: 64px; display: flex; justify-content: space-between; align-items: center; gap: 18px; padding: 14px 0; border-bottom: 1px solid var(--line); }
  .account-list li:last-child { border-bottom: 0; }
  .account-list strong, .account-list small { display: block; }
  .account-list strong { font: 12px/1.3 var(--mono); }
  .account-list small { margin-top: 6px; color: var(--muted); }
  .account-error { padding: 12px 14px; color: var(--error); border: 1px solid rgba(255,155,130,.28); background: rgba(110,35,24,.16); font: 11px/1.5 var(--mono); }
  .account-ledger li { display: grid; grid-template-columns: 1fr auto; }
  .account-ledger time { color: var(--muted); font-size: 11px; }
  .account-amount { color: var(--accent); font: 11px/1 var(--mono); }
  .account-usage-row { display: grid !important; grid-template-columns: minmax(150px,1.5fr) minmax(130px,1fr) 90px 90px 80px; font: 10px/1.4 var(--mono); color: var(--muted); }
  .account-usage-row strong { overflow: hidden; text-overflow: ellipsis; color: var(--ink); }
  .account-invite { margin-bottom: 18px; padding: 16px; overflow-wrap: anywhere; color: var(--accent); border: 1px solid var(--line); font: 11px/1.6 var(--mono); }
  .account-invite code { display: block; margin: 10px 0; }
  .account-dialog { width: min(650px,calc(100% - 30px)); padding: clamp(28px,5vw,52px); border: 1px solid rgba(199,244,170,.36); border-radius: 0; color: var(--ink); background: #0a1510; }
  .account-dialog::backdrop { background: rgba(2,7,4,.78); backdrop-filter: blur(8px); }
  .account-dialog h2 { margin: 0; font: 400 clamp(40px,6vw,62px)/1 var(--serif); }
  .account-dialog p { color: var(--muted); line-height: 1.6; }
  .account-dialog code { display: block; margin: 25px 0; padding: 16px; overflow-wrap: anywhere; border: 1px solid var(--line); color: var(--accent); background: #050b08; }
  @media (max-width: 760px) {
    body.account-surface main#region { grid-template-columns: 1fr; padding-top: 34px; }
    .account-card { grid-column: 1 !important; }
    .account-nav > a:not([aria-current]) { display: none; }
    .account-hero { display: block; }
    .account-vitals { margin-top: 28px; }
    .account-form.two { grid-template-columns: 1fr; }
    .account-usage-row { grid-template-columns: 1fr 90px; }
    .account-usage-row > :nth-child(2), .account-usage-row > :nth-child(3), .account-usage-row > :nth-child(5) { display: none; }
  }
`;

export default {
  name: "account-layout",
  inject: [regionKey, authKey],
  apply(ctx, view) {
    const region = view.get(regionKey);
    const auth = view.get(authKey);
    const header = document.querySelector("body > header");
    const oldTitle = document.title;
    const oldHeader = [...header.childNodes];
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.append(style);
    document.title = "Account — Mycel";
    document.body.classList.add("account-surface");

    const brand = document.createElement("a");
    brand.className = "account-brand";
    brand.href = "/";
    brand.textContent = "mycel";
    const nav = document.createElement("nav");
    nav.className = "account-nav";
    nav.innerHTML =
      '<a href="/account/" aria-current="page">Account</a><a href="/shell/">Exchange</a>';
    const controls = document.createElement("div");
    controls.className = "account-auth-controls";
    const signIn = document.createElement("button");
    signIn.className = "account-button";
    signIn.textContent = "Sign in";
    const signUp = document.createElement("button");
    signUp.className = "account-button primary";
    signUp.textContent = "Create account";
    const user = document.createElement("div");
    controls.append(signIn, signUp, user);
    nav.append(controls);
    header.replaceChildren(brand, nav);

    signIn.addEventListener("click", auth.signIn);
    signUp.addEventListener("click", auth.signUp);
    let userMounted = false;
    const unsubscribe = auth.subscribe((state) => {
      signIn.hidden = state.signedIn || state.loading;
      signUp.hidden = state.signedIn || state.loading;
      if (state.signedIn && !userMounted) {
        auth.mountUserButton(user);
        userMounted = true;
      } else if (!state.signedIn && userMounted) {
        auth.unmountUserButton(user);
        userMounted = false;
      }
    });

    return () => {
      unsubscribe();
      if (userMounted) auth.unmountUserButton(user);
      signIn.removeEventListener("click", auth.signIn);
      signUp.removeEventListener("click", auth.signUp);
      header.replaceChildren(...oldHeader);
      document.title = oldTitle;
      document.body.classList.remove("account-surface");
      style.remove();
      region.className = "";
    };
  },
};
