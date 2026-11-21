module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // .claude/worktrees/ 下是仓库副本，不能混进本项目的测试结果
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/'],
};
