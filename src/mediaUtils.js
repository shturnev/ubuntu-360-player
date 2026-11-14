export function isConvertedVideoName(fileName) {
  return typeof fileName === 'string' && /-\d+(?:-[a-f\d]{12})?-h264\.mp4$/i.test(fileName);
}
