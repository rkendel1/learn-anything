"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { AuthLoading, Authenticated, ConvexReactClient, Unauthenticated } from "convex/react";
import { ReactNode, useState } from "react";

import { SignIn } from "./sign-in";

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

  return (
    <ConvexAuthProvider client={client}>
      <AuthLoading>
        <div className="loading-card">Opening your learning space…</div>
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>{children}</Authenticated>
    </ConvexAuthProvider>
  );
}
