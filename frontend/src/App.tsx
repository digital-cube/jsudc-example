import { UdcClient } from "@jsudc/core/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router";
import { Spinner } from "./components/ui/misc";
import { Toaster } from "./components/ui/toast";
import { TooltipProvider } from "./components/ui/tooltip";
import { UdcDataView } from "./data-view/UdcDataView";
import { I18nProvider, useI18n } from "./i18n/i18n";
import { ThemeProvider } from "./lib/theme";
import { AboutPage } from "./shell/AboutPage";
import { AppShell } from "./shell/AppShell";
import { ErrorState } from "./table/states";
import { TimezoneProvider } from "./time/timezone";
import { useUdcCollections } from "./udc/hooks";
import { createUdcQueryClient, UdcProvider } from "./udc/provider";

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
      <I18nProvider>
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
      </I18nProvider>
    </ThemeProvider>
  );
}
