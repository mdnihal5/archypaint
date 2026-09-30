/// <reference types="vite/client" />
declare module "*.json?raw" {
  const text: string;
  export default text;
}
