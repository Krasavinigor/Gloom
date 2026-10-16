export function isolatedProjectArguments(arguments_: readonly string[]): string[][] {
  if (arguments_.some(argument => argument === '--project' || argument.startsWith('--project='))) {
    return [[...arguments_]];
  }
  return ['desktop', 'mobile'].map(project => [...arguments_, `--project=${project}`]);
}
