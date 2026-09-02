import { Clerk } from "@clerk/clerk-js";

const authKey = { id: "mycel:account-auth" };
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function loadClerkUi(domain) {
  return new Promise((resolve, reject) => {
    if (window.__internal_ClerkUICtor) return resolve();
    const script = document.createElement("script");
    script.src = `https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Clerk UI failed to load")),
      { once: true },
    );
    document.head.append(script);
  });
}

export default {
  name: "account-authentication",
  apply(ctx) {
    let clerk;
    let stopped = false;
    let removeClerkListener;
    let state = {
      available: Boolean(publishableKey),
      loading: Boolean(publishableKey),
      signedIn: false,
    };
    const subscribers = new Set();
    const publish = (next) => {
      state = { ...state, ...next };
      for (const subscriber of subscribers) subscriber(state);
    };
    const service = {
      snapshot: () => state,
      subscribe(subscriber) {
        subscribers.add(subscriber);
        subscriber(state);
        return () => subscribers.delete(subscriber);
      },
      async getToken() {
        const token = await clerk?.session?.getToken();
        if (!token) throw new Error("Your session has expired. Sign in again.");
        return token;
      },
      signIn: () => clerk?.openSignIn({ fallbackRedirectUrl: location.href }),
      signUp: () => clerk?.openSignUp({ fallbackRedirectUrl: location.href }),
      mountUserButton: (element) => clerk?.mountUserButton(element),
      unmountUserButton: (element) => clerk?.unmountUserButton(element),
    };
    ctx.provide(authKey, service);

    if (!publishableKey) {
      publish({ available: false, loading: false });
      return;
    }

    void (async () => {
      try {
        const domain = atob(publishableKey.split("_")[2]).slice(0, -1);
        await loadClerkUi(domain);
        if (stopped) return;
        clerk = new Clerk(publishableKey);
        await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
        if (stopped) return;
        const render = () =>
          publish({
            available: true,
            loading: false,
            signedIn: Boolean(clerk.user),
          });
        removeClerkListener = clerk.addListener(render);
        render();
      } catch {
        publish({ available: false, loading: false, signedIn: false });
      }
    })();

    return () => {
      stopped = true;
      removeClerkListener?.();
      subscribers.clear();
    };
  },
};
