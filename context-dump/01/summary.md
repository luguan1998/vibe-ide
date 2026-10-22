upstream: https://api.deepseek.com/anthropic
model: deepseek-flash
stream: true
system blocks: 3
system chars: 5782 (~1606 tok)
tool count: 23
tools chars: 52515 (~14588 tok)
messages chars: 30899

| tool | chars | est tokens |
|---|---|---|
| Agent | 3178 | ~883 |
| Bash | 3305 | ~918 |
| CronCreate | 3882 | ~1078 |
| CronDelete | 373 | ~104 |
| CronList | 225 | ~63 |
| Edit | 912 | ~253 |
| EnterWorktree | 3907 | ~1085 |
| ExitWorktree | 2404 | ~668 |
| Glob | 679 | ~189 |
| Grep | 3149 | ~875 |
| ListAgents | 1093 | ~304 |
| LSP | 2237 | ~621 |
| NotebookEdit | 1559 | ~433 |
| Read | 1530 | ~425 |
| ReportFindings | 2119 | ~589 |
| ScheduleWakeup | 4788 | ~1330 |
| SendMessage | 5550 | ~1542 |
| Skill | 1744 | ~484 |
| TaskStop | 744 | ~207 |
| WebFetch | 784 | ~218 |
| WebSearch | 802 | ~223 |
| Workflow | 5255 | ~1460 |
| Write | 588 | ~163 |
