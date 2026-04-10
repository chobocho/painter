// Test entry point: imports every *.test.ts to register suites, then runs.

import { installCanvasGlobals } from "./mocks/Canvas.js";
import { installIDBGlobals } from "./mocks/IndexedDB.js";

installCanvasGlobals();
installIDBGlobals();

import "./util.test.js";
import "./core.test.js";
import "./history.test.js";
import "./tools.test.js";
import "./storage.test.js";
import "./input.test.js";
import "./regression.test.js";

import { run } from "./runner.js";
run();
