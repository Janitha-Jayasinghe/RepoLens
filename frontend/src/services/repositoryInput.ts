export function parseRepository(input: string): string {
  let value = input.trim();
  const invalid = () => new Error('Enter owner/repository or a full GitHub repository URL, such as https://github.com/facebook/react.');
  if (value.includes('://')) {
    let url: URL;
    try { url = new URL(value); } catch { throw invalid(); }
    if (!['http:', 'https:'].includes(url.protocol) || !['github.com', 'www.github.com'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.port || url.search || url.hash) throw invalid();
    // Reject encoded paths and dot segments instead of silently normalizing them.
    const rawPath = value.replace(/^[^:]+:\/\/[^/]+/, '');
    if (rawPath.includes('%') || /(?:^|\/)\.\.?(?:\/|$)/.test(rawPath)) throw invalid();
    value = url.pathname.slice(1);
  }
  value = value.replace(/\/$/, '').replace(/\.git$/, '');
  const parts = value.split('/');
  const [owner = '', name = ''] = parts;
  if (parts.length !== 2 || !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(owner) || !/^[a-z0-9_.-]{1,100}$/i.test(name) || ['.', '..'].includes(name)) throw invalid();
  return `${owner}/${name}`;
}
