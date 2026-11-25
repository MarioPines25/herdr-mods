// GitHub / Primer surfaces; intentionally independent of terminal ANSI colors.
export function mergeColors(dark) {
  return dark ? {
    background: '#0d1117', foreground: '#e6edf3', muted: '#9198a1',
    raised: '#161b22', hover: '#212830', border: '#30363d', accent: '#4493f8',
    selected: '#121d2f', branch: '#1c2d41', branchText: '#79c0ff',
    primary: '#238636', primaryHover: '#1f7f32', primaryBorder: '#3c914c',
    warning: '#d29922', warningBorder: '#9e6a03', warningBg: '#281f0a',
    danger: '#f85149', dangerBg: '#2c161b', merged: '#a371f7', mergedBg: '#21162d',
  } : {
    background: '#ffffff', foreground: '#1f2328', muted: '#59636e',
    raised: '#f6f8fa', hover: '#eff2f5', border: '#d1d9e0', accent: '#0969da',
    selected: '#ddf4ff', branch: '#ddf4ff', branchText: '#0969da',
    primary: '#1f883d', primaryHover: '#1a7f37', primaryBorder: '#1f7a39',
    warning: '#9a6700', warningBorder: '#d4a72c', warningBg: '#fff8c5',
    danger: '#d1242f', dangerBg: '#ffebe9', merged: '#8250df', mergedBg: '#fbefff',
  };
}
