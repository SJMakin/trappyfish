export function pagesBasePath() {
  const repository = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'trappyfish';
  const defaultPath = repository.toLowerCase().endsWith('.github.io') ? '/' : `/${repository}/`;
  const segments = (process.env.PAGES_BASE_PATH ?? defaultPath).split('/').filter(Boolean);
  if (segments.some((part) => !/^[\w.-]+$/.test(part) || part === '.' || part === '..')) {
    throw new Error('PAGES_BASE_PATH must be a site path such as /trappyfish/.');
  }
  return segments.length ? `/${segments.join('/')}/` : '/';
}
