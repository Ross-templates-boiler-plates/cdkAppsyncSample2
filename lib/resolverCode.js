import { util } from "@aws-appsync/utils";
export function request(context) {
  return {};
}
export function response(context) {
  return context.prev.result;
}
