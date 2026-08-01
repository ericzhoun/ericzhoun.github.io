export function getOnboardingDeliveryMessage(result) {
  return result.code_sent && result.welcome_sent
    ? "Security code and welcome email sent."
    : result.code_sent
      ? "Security code sent, but the welcome email failed. Try resending again."
      : result.welcome_sent
        ? "Welcome email sent, but the security code failed. Try resending again."
        : "Neither onboarding email could be sent. Try again.";
}

export function replaceAdminNotice(root, markup) {
  root.querySelectorAll(".admin-notice").forEach((notice) => notice.remove());
  root.insertAdjacentHTML("afterbegin", markup);
}
