// CloudFormation definitions only. Importing this module performs no cloud I/O.
const ref = x => ({ Ref:x });
const attr = (x,y) => ({ 'Fn::GetAtt':[x,y] });
const sub = x => ({ 'Fn::Sub':x });
const tags = [{Key:'Project',Value:'YokaiVending'}];
const privateBucket = () => ({Type:'AWS::S3::Bucket',DeletionPolicy:'Retain',UpdateReplacePolicy:'Retain',Properties:{
 PublicAccessBlockConfiguration:{BlockPublicAcls:true,IgnorePublicAcls:true,BlockPublicPolicy:true,RestrictPublicBuckets:true},
 BucketEncryption:{ServerSideEncryptionConfiguration:[{ServerSideEncryptionByDefault:{SSEAlgorithm:'AES256'}}]},
 OwnershipControls:{Rules:[{ObjectOwnership:'BucketOwnerEnforced'}]},Tags:tags}});
export function bootstrapTemplate(){return {AWSTemplateFormatVersion:'2010-09-09',Description:'Private deployment artifacts; no application data',Resources:{Artifacts:{...privateBucket(),Properties:{...privateBucket().Properties,LifecycleConfiguration:{Rules:[{Id:'IncompleteUploads',Status:'Enabled',AbortIncompleteMultipartUpload:{DaysAfterInitiation:1}}]}}}},Outputs:{Bucket:{Value:ref('Artifacts')}}};}
export function appTemplate({reservedConcurrency=2,feedback=false}={}){const template = {
 AWSTemplateFormatVersion:'2010-09-09',Description:'Yokai account service: Free-plan-only deployment; no billing hard cap on paid plans',
 Parameters:{CodeBucket:{Type:'String'},CodeKey:{Type:'String'},CognitoDomainPrefix:{Type:'String',AllowedPattern:'[a-z0-9-]{8,50}'},BudgetEmail:{Type:'String',Default:''}},
 Conditions:{HasBudgetEmail:{'Fn::Not':[{'Fn::Equals':[ref('BudgetEmail'),'']}]}},
 Resources:{
  StateTable:{Type:'AWS::DynamoDB::Table',DeletionPolicy:'Retain',UpdateReplacePolicy:'Retain',Properties:{BillingMode:feedback?'PAY_PER_REQUEST':'PROVISIONED',AttributeDefinitions:[{AttributeName:'PK',AttributeType:'S'},{AttributeName:'SK',AttributeType:'S'}],KeySchema:[{AttributeName:'PK',KeyType:'HASH'},{AttributeName:'SK',KeyType:'RANGE'}],...(feedback?{OnDemandThroughput:{MaxReadRequestUnits:100,MaxWriteRequestUnits:200}}:{ProvisionedThroughput:{ReadCapacityUnits:5,WriteCapacityUnits:5}}),SSESpecification:{SSEEnabled:false},DeletionProtectionEnabled:true,Tags:tags}},
  Photos:privateBucket(), Site:privateBucket(),
  SiteOriginAccess:{Type:'AWS::CloudFront::OriginAccessControl',Properties:{OriginAccessControlConfig:{Name:sub('${AWS::StackName}-site'),OriginAccessControlOriginType:'s3',SigningBehavior:'always',SigningProtocol:'sigv4'}}},
  SiteDistribution:{Type:'AWS::CloudFront::Distribution',Properties:{Tags:tags,DistributionConfig:{Enabled:true,DefaultRootObject:'index.html',HttpVersion:'http2',PriceClass:'PriceClass_100',Origins:[{Id:'site',DomainName:attr('Site','RegionalDomainName'),OriginAccessControlId:attr('SiteOriginAccess','Id'),S3OriginConfig:{OriginAccessIdentity:''}}],DefaultCacheBehavior:{TargetOriginId:'site',ViewerProtocolPolicy:'redirect-to-https',AllowedMethods:['GET','HEAD','OPTIONS'],CachedMethods:['GET','HEAD'],Compress:true,MinTTL:0,DefaultTTL:3600,MaxTTL:31536000,ForwardedValues:{QueryString:false,Cookies:{Forward:'none'}}},ViewerCertificate:{CloudFrontDefaultCertificate:true}}}},
  SitePolicy:{Type:'AWS::S3::BucketPolicy',Properties:{Bucket:ref('Site'),PolicyDocument:{Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'cloudfront.amazonaws.com'},Action:'s3:GetObject',Resource:sub('${Site.Arn}/*'),Condition:{StringEquals:{'AWS:SourceArn':sub('arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${SiteDistribution}')}}}]}}},
  UserPool:{Type:'AWS::Cognito::UserPool',DeletionPolicy:'Retain',UpdateReplacePolicy:'Retain',Properties:{UserPoolTier:'LITE',UsernameAttributes:['email'],AutoVerifiedAttributes:['email'],UsernameConfiguration:{CaseSensitive:false},MfaConfiguration:'OFF',AccountRecoverySetting:{RecoveryMechanisms:[{Name:'verified_email',Priority:1}]},Policies:{PasswordPolicy:{MinimumLength:12,RequireLowercase:true,RequireUppercase:true,RequireNumbers:true,RequireSymbols:false}},UserPoolTags:{Project:'YokaiVending'}}},
  UserClient:{Type:'AWS::Cognito::UserPoolClient',Properties:{UserPoolId:ref('UserPool'),GenerateSecret:false,AllowedOAuthFlowsUserPoolClient:true,AllowedOAuthFlows:['code'],AllowedOAuthScopes:['openid','email'],SupportedIdentityProviders:['COGNITO'],CallbackURLs:[sub('https://${SiteDistribution.DomainName}/')],LogoutURLs:[sub('https://${SiteDistribution.DomainName}/')],PreventUserExistenceErrors:'ENABLED',EnableTokenRevocation:true,AccessTokenValidity:feedback?480:30,IdTokenValidity:feedback?480:30,RefreshTokenValidity:1,TokenValidityUnits:{AccessToken:'minutes',IdToken:'minutes',RefreshToken:'days'}}},
  UserDomain:{Type:'AWS::Cognito::UserPoolDomain',Properties:{UserPoolId:ref('UserPool'),Domain:ref('CognitoDomainPrefix'),ManagedLoginVersion:1}},
  ApiLogs:{Type:'AWS::Logs::LogGroup',Properties:{LogGroupName:sub('/aws/lambda/${AWS::StackName}-api'),RetentionInDays:7,Tags:tags}},
  ApiRole:{Type:'AWS::IAM::Role',Properties:{AssumeRolePolicyDocument:{Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'lambda.amazonaws.com'},Action:'sts:AssumeRole'}]},Policies:[{PolicyName:'OwnDataOnly',PolicyDocument:{Version:'2012-10-17',Statement:[{Effect:'Allow',Action:['dynamodb:GetItem','dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:Query','dynamodb:ConditionCheckItem'],Resource:attr('StateTable','Arn')},{Effect:'Allow',Action:['s3:GetObject','s3:PutObject'],Resource:sub('${Photos.Arn}/*')},{Effect:'Allow',Action:['logs:CreateLogStream','logs:PutLogEvents'],Resource:attr('ApiLogs','Arn')}]}}],Tags:tags}},
  Api:{Type:'AWS::Lambda::Function',DependsOn:['ApiLogs'],Properties:{FunctionName:sub('${AWS::StackName}-api'),Runtime:'nodejs24.x',Architectures:['arm64'],Handler:'index.handler',Role:attr('ApiRole','Arn'),Code:{S3Bucket:ref('CodeBucket'),S3Key:ref('CodeKey')},MemorySize:256,Timeout:5,...(reservedConcurrency===null?{}:{ReservedConcurrentExecutions:reservedConcurrency}),Environment:{Variables:{ACCOUNT_TABLE:ref('StateTable'),ACCOUNT_PHOTO_BUCKET:ref('Photos'),COGNITO_USER_POOL_ID:ref('UserPool'),COGNITO_CLIENT_ID:ref('UserClient'),ALLOWED_ORIGIN:sub('https://${SiteDistribution.DomainName}')}},Tags:tags}},
  ApiUrl:{Type:'AWS::Lambda::Url',Properties:{TargetFunctionArn:attr('Api','Arn'),AuthType:'NONE',InvokeMode:'BUFFERED'}},
  ApiUrlPermission:{Type:'AWS::Lambda::Permission',Properties:{FunctionName:ref('Api'),Action:'lambda:InvokeFunctionUrl',Principal:'*',FunctionUrlAuthType:'NONE'}},
  ApiInvokePermission:{Type:'AWS::Lambda::Permission',Properties:{FunctionName:ref('Api'),Action:'lambda:InvokeFunction',Principal:'*',InvokedViaFunctionUrl:true}},
  MonthlyBudget:{Type:'AWS::Budgets::Budget',Condition:'HasBudgetEmail',Properties:{Budget:{BudgetName:sub('${AWS::StackName}-account-monthly'),BudgetType:'COST',TimeUnit:'MONTHLY',BudgetLimit:{Amount:5,Unit:'USD'},CostTypes:{IncludeCredit:false,IncludeRefund:false}},NotificationsWithSubscribers:[80,100].map(Threshold=>({Notification:{NotificationType:'ACTUAL',ComparisonOperator:'GREATER_THAN',Threshold,ThresholdType:'PERCENTAGE'},Subscribers:[{SubscriptionType:'EMAIL',Address:ref('BudgetEmail')}]}))}}
 },
 Outputs:{ApiUrl:{Value:attr('ApiUrl','FunctionUrl')},SiteBucket:{Value:ref('Site')},SiteUrl:{Value:sub('https://${SiteDistribution.DomainName}')},DistributionId:{Value:ref('SiteDistribution')},StateTable:{Value:ref('StateTable')},PhotoBucket:{Value:ref('Photos')},UserPoolId:{Value:ref('UserPool')},ClientId:{Value:ref('UserClient')},CognitoDomain:{Value:sub('https://${CognitoDomainPrefix}.auth.${AWS::Region}.amazoncognito.com')},FunctionName:{Value:ref('Api')}}
 };
 if(feedback){
  for(const key of ['UserPool','UserClient','UserDomain'])delete template.Resources[key];
  for(const key of ['UserPoolId','ClientId','CognitoDomain'])delete template.Outputs[key];
  delete template.Parameters.CognitoDomainPrefix;
  template.Parameters.AccessCodeHashes={Type:'String',NoEcho:true,Description:'Exactly 15 SHA256 code hashes and account subjects; never plaintext codes'};
  const env=template.Resources.Api.Properties.Environment.Variables;
  delete env.COGNITO_USER_POOL_ID;delete env.COGNITO_CLIENT_ID;
  env.AUTH_MODE='invite-code';env.ACCESS_CODE_HASHES=ref('AccessCodeHashes');
 }
 return template;
}
