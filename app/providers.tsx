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
      <p>The Convex deployment URL is not available to this preview yet.</p>
      <p>Connect the project&apos;s Convex integration, then restart the preview.</p>
    </div>;
  }
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
