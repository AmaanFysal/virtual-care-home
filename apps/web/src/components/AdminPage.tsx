import { useState } from "react";
import { signIn, signOut } from "../net";
import { useView } from "../store";

/**
 * The hidden admin page (#/admin): asks for the admin token and sends it to the server, which
 * decides. The token is typed here and kept for this tab only; it's never part of the app's code.
 */
export function AdminPage() {
  const role = useView((s) => s.role);
  const message = useView((s) => s.authMessage);
  const status = useView((s) => s.status);
  const [token, setToken] = useState("");
  if (role === "admin") {
    return (
      <div className="admin-page">
        <p>Signed in as admin: the clock, the Director tab and event injection are unlocked.</p>
        <button
          onClick={() => {
            signOut();
            location.hash = "";
          }}
        >
          Sign out
        </button>
      </div>
    );
  }
  return (
    <form
      className="admin-page"
      onSubmit={(e) => {
        e.preventDefault();
        if (token) signIn(token);
        setToken("");
      }}
    >
      <label>
        Admin token
        <input type="password" autoComplete="current-password" value={token} onChange={(e) => setToken(e.target.value)} />
      </label>
      <button type="submit" disabled={!token || status !== "open"}>
        Sign in
      </button>
      {message && <p className="error">{message}</p>}
    </form>
  );
}
