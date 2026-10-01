import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { connect } from "./net";
import { select } from "./selection";
import { useView } from "./store";
import "./styles.css";

connect();

// The hidden admin page (#/admin): a token prompt for the public server's controls.
const onHash = () => useView.setState({ adminPage: location.hash === "#/admin" });
onHash();
window.addEventListener("hashchange", onHash);

// ?select=<person id>&follow=1 opens the inspector on someone (handy for demos and links), and
// ?tags=0 starts with name tags off (screenshots).
const params = new URLSearchParams(location.search);
if (params.get("tags") === "0") useView.setState({ showTags: false });
const wanted = params.get("select");
if (wanted) {
  const stop = useView.subscribe((state) => {
    if (!state.people[wanted]) return;
    stop();
    useView.setState({ following: params.get("follow") === "1" });
    select(wanted);
  });
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
