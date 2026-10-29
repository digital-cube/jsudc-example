import { Building2, Circle, type LucideIcon, User, Users } from "lucide-react";
import { LUCIDE_ICONS } from "./lucide.generated";

/** What an unknown name draws: a row never breaks over its icon. */
export const FALLBACK_ICON: LucideIcon = Circle;

/** The bare names the org tree's rows carry (before `lucide:` existed). */
const BARE: Readonly<Record<string, LucideIcon>> = {
  building: Building2,
  users: Users,
  user: User,
};

/**
 * The icon a row names: `lucide:<kebab-name>` from the generated map of the
 * icons the repo references (`scripts/generate-icons.mjs`), a bare legacy
 * name, else the fallback. `null` for no name at all.
 */
export function resolveIcon(name: unknown): LucideIcon | null {
  if (typeof name !== "string" || name.trim() === "") return null;
  const value = name.trim();
  if (value.startsWith("lucide:"))
    return LUCIDE_ICONS[value.slice("lucide:".length)] ?? FALLBACK_ICON;
  return BARE[value] ?? FALLBACK_ICON;
}
