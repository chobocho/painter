import { Color, RGBA } from "../util/Color.js";

const SWATCHES: string[] = [
  "red", "orange", "yellow", "green", "blue",
  "lightblue", "lightgreen", "brown", "purple", "pink",
  "gray", "lightgray", "black", "white",
];

export class Palette {
  current: RGBA = Color.parse("red");

  constructor(
    private root: HTMLElement,
    private onChange: (c: RGBA) => void
  ) {}

  render(): void {
    this.root.innerHTML = "";
    for (const name of SWATCHES) {
      const c = Color.parse(name);
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "swatch";
      sw.title = name;
      sw.style.background = Color.toCss(c);
      sw.addEventListener("click", () => this.set(c));
      this.root.appendChild(sw);
    }
    const picker = document.createElement("input");
    picker.type = "color";
    picker.className = "color-picker";
    picker.value = Color.toHex(this.current);
    picker.addEventListener("input", () => this.set(Color.parse(picker.value)));
    this.root.appendChild(picker);
  }

  set(c: RGBA): void {
    this.current = c;
    this.onChange(c);
    const picker = this.root.querySelector<HTMLInputElement>(".color-picker");
    if (picker) picker.value = Color.toHex(c);
  }
}
