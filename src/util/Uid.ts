let counter = 0;
let prefix = Math.floor(Math.random() * 1e6).toString(36);

export const Uid = {
  next(): string {
    counter++;
    return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
  },
  reset(p?: string): void {
    counter = 0;
    if (p) prefix = p;
  },
};
