import test from 'node:test';import assert from 'node:assert/strict';
const policy=await import('../infra/cache-policy.mjs').catch(()=>({}));
test('only content-addressed public files receive immutable cache policy',()=>{
 assert.equal(typeof policy.cacheControlFor,'function');
 assert.equal(policy.cacheControlFor('index.html'),'no-store');assert.equal(policy.cacheControlFor('account-config.json'),'no-store');
 assert.equal(policy.cacheControlFor('game-content/'+ 'a'.repeat(64)+'.png'),'public,max-age=31536000,immutable');
 assert.equal(policy.cacheControlFor('game-assets/background.png'),'public,max-age=86400');
});

test('CloudFront allows long immutable caching without forcing mutable config into cache',async()=>{
 const {appTemplate}=await import('../infra/template.mjs');const b=appTemplate({feedback:true}).Resources.SiteDistribution.Properties.DistributionConfig.DefaultCacheBehavior;
 assert.equal(b.MinTTL,0);assert.equal(b.MaxTTL,31536000);assert.equal(policy.cacheControlFor('account-config.json'),'no-store');
});
