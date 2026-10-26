export type AccountDisplayUser = {
  email: string | null;
  phone: string | null;
  displayName: string;
  isGuest?: boolean;
};

export function formatAccountPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const mainlandMobile = /^\+86(1[3-9]\d{9})$/u.exec(phone);
  if (mainlandMobile) return mainlandMobile[1];
  return phone;
}

export function formatAccountName(user: AccountDisplayUser | null | undefined, fallback = "已登录"): string {
  if (!user) return fallback;
  if (user.isGuest) return "访客";

  const phoneLabel = formatAccountPhone(user.phone);
  const displayName = user.displayName.trim();
  if (displayName && displayName !== user.phone) return displayName;
  return phoneLabel || user.email || displayName || fallback;
}
