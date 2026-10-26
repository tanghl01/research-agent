// Isolates a local-development workaround for wallet extensions that inject
// window.StacksProvider and trip the Next.js dev overlay. Production renders
// nothing, so app behavior stays unchanged outside dev.
const enableLocalExtensionErrorFilter = process.env.NODE_ENV !== "production";

const localExtensionErrorFilterScript = `
  (function () {
    function shouldSuppressStacksProviderError(value) {
      var message = "";
      if (value && typeof value === "object" && "message" in value) {
        message = String(value.message || "");
      } else {
        message = String(value || "");
      }
      return (
        message.indexOf("Cannot redefine property: StacksProvider") !== -1 ||
        message.indexOf("Failed setting Xverse Stacks default provider") !== -1 ||
        message.indexOf("Unable to set StacksProvider") !== -1
      );
    }

    function shouldSuppressConsoleArgs(args) {
      for (var index = 0; index < args.length; index += 1) {
        if (shouldSuppressStacksProviderError(args[index])) return true;
      }
      return false;
    }

    if (window.console && window.console.error && !window.console.error.__operatorStacksProviderFiltered) {
      var originalError = window.console.error;
      var filteredError = function () {
        if (shouldSuppressConsoleArgs(arguments)) return;
        return originalError.apply(window.console, arguments);
      };
      filteredError.__operatorStacksProviderFiltered = true;
      window.console.error = filteredError;
    }

    window.addEventListener("error", function (event) {
      if (shouldSuppressStacksProviderError(event.error) || shouldSuppressStacksProviderError(event.message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);

    window.addEventListener("unhandledrejection", function (event) {
      if (shouldSuppressStacksProviderError(event.reason)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  })();
`;

export function LocalExtensionErrorFilter() {
  if (!enableLocalExtensionErrorFilter) return null;
  return (
    <script
      id="suppress-wallet-extension-stacks-provider-error"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: localExtensionErrorFilterScript }}
    />
  );
}
