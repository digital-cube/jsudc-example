import { isUdcError } from "@jsudc/core";
import type { UdcClient } from "@jsudc/core/client";
import { QueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";

const UdcClientContext = createContext<UdcClient | null>(null);

export function UdcProvider({ client, children }: { client: UdcClient; children: ReactNode }) {
  return <UdcClientContext.Provider value={client}>{children}</UdcClientContext.Provider>;
}

export function useUdcClient(): UdcClient {
  const client = useContext(UdcClientContext);
  if (!client) throw new Error("useUdcClient needs a <UdcProvider client={...}> above it");
  return client;
}

/**
 * A protocol error is the server's answer, not a hiccup: asking again gives
 * the same answer. Only transport failures are retried, twice.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return !isUdcError(error) && failureCount < 2;
}

export function createUdcQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}
