import { createRoot } from "react-dom/client";
import { Auth0Provider } from '@auth0/auth0-react';
import App from "./App.tsx";
import "./index.css";
import { auth0TestConfig, isAuth0TestConfigured } from '@/lib/auth0Test';
import { auth0LiveConfig, isAuth0LiveConfigured, isAuth0LiveEnabled } from '@/lib/auth0Live';

const app = <App />;
const useAuth0TestProvider = !isAuth0LiveEnabled && isAuth0TestConfigured;
const auth0Config = isAuth0LiveConfigured ? auth0LiveConfig : auth0TestConfig;
const hasAuth0Provider = isAuth0LiveConfigured || useAuth0TestProvider;

createRoot(document.getElementById("root")!).render(
  hasAuth0Provider ? (
    <Auth0Provider
      domain={auth0Config.domain!}
      clientId={auth0Config.clientId!}
      cacheLocation="localstorage"
      authorizationParams={{
        redirect_uri: auth0Config.redirectUri,
        ...(auth0Config.audience ? { audience: auth0Config.audience } : {}),
      }}
    >
      {app}
    </Auth0Provider>
  ) : app,
);
