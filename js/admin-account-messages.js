export function getOnboardingDeliveryMessage(result) {
  return result.code_sent && result.welcome_sent
    ? "Security code and welcome email sent."
    : result.code_sent
      ? "Security code sent, but the welcome email failed. Try resending again."
      : result.welcome_sent
        ? "Welcome email sent, but the security code failed. Try resending again."
        : "Neither onboarding email could be sent. Try again.";
}

export function getAccountCreationMessage(result) {
  if (!result.profile_saved) {
    return "Account created, but profile setup is incomplete. Complete setup without recreating the account.";
  }
  return result.welcome_sent
    ? "Account created and welcome email sent."
    : "Account created, but the welcome email could not be sent. Resend onboarding emails.";
}

export function getRecoveryMessage(result) {
  if (!result.profile_saved) {
    return "The account exists, but profile setup is still incomplete. Try recovery again.";
  }
  return `Profile setup completed. ${getOnboardingDeliveryMessage(result)}`;
}

export function replaceAdminNotice(root, markup) {
  root.querySelectorAll(".admin-notice[data-transient-notice]").forEach((notice) => notice.remove());
  root.insertAdjacentHTML("afterbegin", markup);
}
