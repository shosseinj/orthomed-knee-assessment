import type { User } from "../types";

const roleLabels = { patient: "بیمار", doctor: "پزشک", insurance: "کارشناس بیمه", admin: "مدیر سامانه" };

export function accountRoleLabel(user: User): string {
  return user.can_manage_accounts ? "مدیر سامانه" : roleLabels[user.role];
}
