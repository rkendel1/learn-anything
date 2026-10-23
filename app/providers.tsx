"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useState } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    return url ? new ConvexReactClient(url) : null;
  });

  if (!client) {
    return <div className="setup-notice">
      <h2>Connect your Convex project</h2>
      <p>In a terminal, run <code>npx convex dev</code>, then put the generated deployment URL in <code>.env.local</code> as <code>NEXT_PUBLIC_CONVEX_URL</code>.</p>
      <p>Restart the Next.js dev server after setting the variable.</p>
    </div>;
  }
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}