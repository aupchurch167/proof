export function attentionHeadline(count) {
  if (count === 0) return 'Nothing needs you.';
  if (count === 1) return '1 thing needs you.';
  return `${count} things need you.`;
}
