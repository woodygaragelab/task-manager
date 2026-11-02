// sam deploy 後に表示される Outputs の値をここに反映してください。
//   UserPoolId       -> userPoolId
//   UserPoolClientId -> userPoolClientId
//   WebApiEndpoint    -> apiBaseUrl(末尾にスラッシュは付けない)
export const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: "ap-northeast-1_wGVca3Fe0",
      userPoolClientId: "87g3jc0t1ebfci33ko480rb6q",
    },
  },
};

export const API_BASE_URL =
  "https://11hha28k59.execute-api.ap-northeast-1.amazonaws.com";
