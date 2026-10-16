import { createRoot } from "react-dom/client";
import { Auth0Provider } from '@auth0/auth0-react';
import App from "./App.tsx";
import "./index.css";
import { auth0TestConfig, isAuth0TestConfigured } from '@/lib/auth0Test';

const app = <App />;

createRoot(document.getElementById("root")!).render(
  isAuth0TestConfigured ? (
    <Auth0Provider
      domain={auth0TestConfig.domain!}
      clientId={auth0TestConfig.clientId!}
      authorizationParams={{
        redirect_uri: auth0TestConfig.redirectUri,
        ...(auth0TestConfig.audience ? { audience: auth0TestConfig.audience } : {}),
      }}
    >
      {app}
    </Auth0Provider>
  ) : app,
);
