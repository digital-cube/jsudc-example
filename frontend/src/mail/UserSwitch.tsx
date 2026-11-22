import { useI18n } from "@jsudc/react";
import { Segmented } from "@jsudc/react/ui";
import { UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { DEMO_USERS, type DemoUserChoice, useDemoUser } from "./demoUser";

/** What `createUdcQueryClient({ onUnauthenticated })` fires (src/App.tsx). */
export const SIGNED_OUT_EVENT = "example:signed-out";

/**
 * The header's user switcher: which demo user the app plays (no login). The
 * mailbox shows that user's rows only; "Nobody" sends no user, and the
 * mailbox answers "not signed in", which the query client reports here.
 */
export function UserSwitch() {
  const { t } = useI18n();
  const [user, setUser] = useDemoUser();
  const signedOut = useSignedOutHint(user);
  return (
    <div
      className="flex items-center gap-2"
      data-testid="demo-user"
      data-signed-out={signedOut ? "true" : undefined}
    >
      <UserRound
        className={signedOut ? "size-4 text-danger" : "size-4 text-muted-foreground"}
        aria-hidden
      />
      <Segmented<DemoUserChoice>
        aria-label={t("APP", "DEMO_USER")}
        data-testid="user-switch"
        value={user}
        onChange={setUser}
        options={[...DEMO_USERS, "none" as const].map((u) => ({
          value: u,
          label: t("APP", `USER_${u.toUpperCase()}`),
          testId: `user-${u}`,
        }))}
      />
    </div>
  );
}

/** True after the server said "not signed in", until a user is picked. */
function useSignedOutHint(user: DemoUserChoice): boolean {
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    const on = () => setSignedOut(true);
    window.addEventListener(SIGNED_OUT_EVENT, on);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, on);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new choice clears the hint
  useEffect(() => setSignedOut(false), [user]);
  return signedOut && user === "none";
}
