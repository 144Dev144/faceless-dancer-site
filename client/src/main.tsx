import { render } from "preact";
import "./lib/ensureBrowserBuffer";
import { App } from "./App";
import "./styles.css";

render(<App />, document.getElementById("app")!);
