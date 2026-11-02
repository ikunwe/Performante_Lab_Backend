const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requestDtos } = require('../src/services/requests');
test('admin requests include sender avatars for lists and review responses, with safe fallback', async () => {
  const calls = [];
  const admin = {auth: {admin: {getUserById: async id => {
    calls.push(id);
    if (id === 'missing') throw new Error('unavailable');
    return {data: {user: {email: 'private@test', user_metadata: {picture: 'https://test/sender.png'}}}};
  }}}};
  const rows = ['sender', 'sender', 'missing'].map((id, i) => ({id: String(i), user_id: id, status: 'Pending', profiles: {username: 'Driver'}}));
  const results = await requestDtos(admin, rows, {includeAuthorAvatar: true});
  assert.deepEqual(calls, ['sender', 'missing']);
  assert.equal(results[0].authorAvatar, 'https://test/sender.png');
  assert.equal(results[1].authorAvatar, 'https://test/sender.png');
  assert.equal(results[2].authorAvatar, '');
  assert.ok(!JSON.stringify(results).includes('private@test'));
  const [review] = await requestDtos(admin, [{...rows[0], status: 'Accepted'}], {includeAuthorAvatar: true});
  assert.equal(review.authorAvatar, results[0].authorAvatar);
});
