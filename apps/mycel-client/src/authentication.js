const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const signUpButtons = [...document.querySelectorAll("[data-sign-up]")];
const signInButtons = [...document.querySelectorAll("[data-sign-in]")];
const userButton = document.querySelector("#user-button");

function markUnavailable() {
  for (const button of [...signUpButtons, ...signInButtons]) {
    button.disabled = true;
    button.title = "Clerk is not configured in this environment";
  }
}

function loadClerkUi(domain) {
  return new Promise((resolve, reject) => {
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

export async function initializeAuthentication({ onStateChange } = {}) {
  if (!publishableKey || !userButton) {
    markUnavailable();
    onStateChange?.({ clerk: null, signedIn: false, available: false });
    return;
  }

  let clerk;
  try {
    const domain = atob(publishableKey.split("_")[2]).slice(0, -1);
    await loadClerkUi(domain);
    const { Clerk } = await import("@clerk/clerk-js");
    clerk = new Clerk(publishableKey);
    await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
  } catch {
    markUnavailable();
    onStateChange?.({ clerk: null, signedIn: false, available: false });
    return;
  }

  let userButtonMounted = false;
  const render = () => {
    const signedIn = Boolean(clerk.user);
    for (const button of [...signUpButtons, ...signInButtons]) {
      button.hidden = signedIn;
    }
    if (signedIn && !userButtonMounted) {
      clerk.mountUserButton(userButton);
      userButtonMounted = true;
    } else if (!signedIn && userButtonMounted) {
      clerk.unmountUserButton(userButton);
      userButtonMounted = false;
    }
    onStateChange?.({ clerk, signedIn, available: true });
  };

  for (const button of signUpButtons) {
    button.addEventListener("click", () =>
      clerk.openSignUp({ fallbackRedirectUrl: "/" }),
    );
  }
  for (const button of signInButtons) {
    button.addEventListener("click", () =>
      clerk.openSignIn({ fallbackRedirectUrl: "/" }),
    );
  }

  clerk.addListener(render);
  render();
}
