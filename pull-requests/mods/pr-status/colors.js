// Opaque GitHub / Primer-style light and dark tokens, isolated from terminal
// ANSI overrides. Code stays neutral; the background carries diff semantics.
export function githubColors(dark) {
  return dark ? {
    background: "#0d1117", foreground: "#e6edf3", muted: "#9198a1", dim: "#6e7681",
    raised: "#161b22", hover: "#212830", selected: "#121d2f", border: "#30363d",
    accent: "#4493f8", ansi1: "#f85149", ansi2: "#3fb950", blocked: "#d29922",
    addition: "#12261e", additionGutter: "#1b3926", additionText: "#e6edf3",
    deletion: "#2c161b", deletionGutter: "#472027", deletionText: "#e6edf3",
    hunk: "#151f2e", hunkGutter: "#1b2a41", hunkText: "#9198a1",
    gutterText: "#7d8590", primary: "#238636", primaryHover: "#1f7f32",
    primaryText: "#ffffff", primaryBorder: "#3c914c", badge: "#30363d",
    branch: "#1c2d41", branchText: "#79c0ff", editor: "#0d1117",
    successBg: "#12261e", dangerBg: "#2c161b", closed: "#a371f7", draft: "#656c76",
  } : {
    background: "#ffffff", foreground: "#1f2328", muted: "#59636e", dim: "#6e7781",
    raised: "#f6f8fa", hover: "#eff2f5", selected: "#ddf4ff", border: "#d1d9e0",
    accent: "#0969da", ansi1: "#d1242f", ansi2: "#1a7f37", blocked: "#9a6700",
    addition: "#e6ffec", additionGutter: "#ccffd8", additionText: "#1f2328",
    deletion: "#ffebe9", deletionGutter: "#ffd7d5", deletionText: "#1f2328",
    hunk: "#f1f8ff", hunkGutter: "#ddf4ff", hunkText: "#59636e",
    gutterText: "#59636e", primary: "#1f883d", primaryHover: "#1a7f37",
    primaryText: "#ffffff", primaryBorder: "#1f7a39", badge: "#e8ebef",
    branch: "#ddf4ff", branchText: "#0969da", editor: "#f6f8fa",
    successBg: "#dafbe1", dangerBg: "#ffebe9", closed: "#8250df", draft: "#656d76",
  };
}
