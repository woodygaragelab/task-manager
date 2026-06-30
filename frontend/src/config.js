// sam deploy 後に表示される Outputs の値をここに反映してください。
//   UserPoolId       -> userPoolId
//   UserPoolClientId -> userPoolClientId
//   WebApiEndpoint    -> apiBaseUrl(末尾にスラッシュは付けない)
export const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: "ap-northeast-1_WgwchFez1",
      userPoolClientId: "5n5nj17i1qensg6fe154kn8k6n",
    },
  },
};

export const API_BASE_URL =
  "https://izomsyzy21.execute-api.ap-northeast-1.amazonaws.com";
