import { UdcClient } from "@jsudc/core/client";
import {
  createUdcQueryClient,
  ErrorState,
  Spinner,
  ThemeProvider,
  TimezoneProvider,
  Toaster,
  TooltipProvider,
  UdcDataView,
  UdcI18nProvider,
  UdcProvider,
  useI18n,
  useUdcCollections,
} from "@jsudc/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router";
import { EXAMPLE_MESSAGES } from "./i18n/messages";
import { AboutPage } from "./shell/AboutPage";
import { AppShell } from "./shell/AppShell";

/** `/`: the first collection the server lists. */
function FirstCollection() {
  const { t } = useI18n();
  const collections = useUdcCollections();
  if (collections.error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <ErrorState error={collections.error} onRetry={() => void collections.refetch()} />
      </div>
    );
  }
  const first = collections.data?.collections[0];
  if (first) return <Navigate to={`/udc/${first.name}`} replace />;
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {collections.data ? t("APP", "NO_COLLECTIONS") : <Spinner />}
    </div>
  );
}

function CollectionRoute() {
  const { collection = "" } = useParams();
  // Keyed: switching collections starts from a fresh view, not the old one's edit state.
  return <UdcDataView key={collection} collection={collection} />;
}

export function App() {
  const [client] = useState(() => new UdcClient({ httpUrl: import.meta.env.VITE_UDC_URL ?? "" }));
  const [queryClient] = useState(createUdcQueryClient);
  return (
    <ThemeProvider>
      <UdcI18nProvider messages={EXAMPLE_MESSAGES}>
        <TimezoneProvider>
          <UdcProvider client={client}>
            <QueryClientProvider client={queryClient}>
              <TooltipProvider delayDuration={400}>
                <Toaster>
                  <BrowserRouter>
                    <Routes>
                      <Route element={<AppShell />}>
                        <Route index element={<FirstCollection />} />
                        <Route path="udc/:collection" element={<CollectionRoute />} />
                        <Route path="about" element={<AboutPage />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Route>
                    </Routes>
                  </BrowserRouter>
                </Toaster>
              </TooltipProvider>
            </QueryClientProvider>
          </UdcProvider>
        </TimezoneProvider>
      </UdcI18nProvider>
    </ThemeProvider>
  );
}
