// Filename overrides precede extensions; unknown files keep a neutral document icon.
export function fileIcon(path) {
  const name = path.split(/[\\/]/).pop().toLowerCase();
  if (/^dockerfile(?:\.|$)/.test(name)) return { label: 'D', color: 'ansi4' };
  if (/^(?:\.gitignore|\.gitattributes|\.gitmodules)$/.test(name)) return { label: 'Git', color: 'ansi1' };
  if (/^(?:\.env(?:\..*)?|.*\.(?:config|conf|ini|toml)|.*rc)$/.test(name)) return { label: '⚙', color: 'muted' };
  if (/^(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|.*\.lock)$/.test(name)) return { label: '≡', color: 'muted' };
  const ext = name.includes('.') ? name.split('.').pop() : '';
  const types = {
    ts: ['TS', 'ansi4'], tsx: ['TSX', 'ansi6'], js: ['JS', 'ansi3'], jsx: ['JSX', 'ansi6'],
    mjs: ['JS', 'ansi3'], cjs: ['JS', 'ansi3'], json: ['{}', 'ansi3'], jsonc: ['{}', 'ansi3'],
    html: ['<>', 'ansi1'], htm: ['<>', 'ansi1'], xml: ['<>', 'ansi1'], svg: ['◇', 'ansi3'],
    css: ['#', 'ansi4'], scss: ['#', 'ansi5'], sass: ['#', 'ansi5'], less: ['#', 'ansi4'],
    md: ['M↓', 'ansi4'], mdx: ['M↓', 'ansi6'], txt: ['≡', 'muted'],
    yml: ['Y', 'ansi5'], yaml: ['Y', 'ansi5'], py: ['Py', 'ansi3'],
    go: ['Go', 'ansi6'], rs: ['Rs', 'ansi1'], java: ['J', 'ansi1'], kt: ['K', 'ansi5'],
    cs: ['C#', 'ansi5'], c: ['C', 'ansi4'], h: ['H', 'ansi5'], cpp: ['C++', 'ansi4'],
    swift: ['S', 'ansi1'], rb: ['Rb', 'ansi1'], php: ['php', 'ansi5'],
    sh: ['>_', 'ansi2'], bash: ['>_', 'ansi2'], zsh: ['>_', 'ansi2'], fish: ['>_', 'ansi2'],
    sql: ['DB', 'ansi3'], graphql: ['G', 'ansi5'], gql: ['G', 'ansi5'],
    vue: ['V', 'ansi2'], svelte: ['S', 'ansi1'],
    png: ['▧', 'ansi5'], jpg: ['▧', 'ansi5'], jpeg: ['▧', 'ansi5'], gif: ['▧', 'ansi5'], webp: ['▧', 'ansi5'], ico: ['▧', 'ansi5'],
    pdf: ['PDF', 'ansi1'], zip: ['ZIP', 'ansi3'], gz: ['ZIP', 'ansi3'],
  };
  const type = types[ext];
  return type ? { label: type[0], color: type[1] } : { label: null, color: 'muted' };
}
