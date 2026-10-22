// hosts file block between Deepwork markers — shared by the Windows and macOS layers.
const fs = require('fs');

const MARK_A = '# >>> deepwork (auto, removed after focus)';
const MARK_B = '# <<< deepwork';

function hostsFile(file, eol) {
  const read = () => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
  // the markers contain "(" and ")": they must be escaped, or the block would never match and stay forever
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const strip = text => text
    .replace(new RegExp(`\\r?\\n?${esc(MARK_A)}[\\s\\S]*?${esc(MARK_B)}\\r?\\n?`, 'g'), eol)
    .replace(/(\r?\n){3,}$/, eol);
  return {
    file,
    read,
    hasBlock: () => read().includes(MARK_A),
    // the full new file text: existing content without our block, plus the block for `domains`
    build(domains) {
      let text = strip(read()).replace(/\s+$/, '') + eol;
      if (domains.length) {
        const lines = [];
        for (const d of domains) {
          lines.push(`0.0.0.0 ${d}`);
          if (!d.startsWith('www.') && d.split('.').length === 2) lines.push(`0.0.0.0 www.${d}`);
        }
        text += `${eol}${MARK_A}${eol}${lines.join(eol)}${eol}${MARK_B}${eol}`;
      }
      return text;
    },
  };
}

module.exports = { hostsFile };
