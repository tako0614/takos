For software or automation work, start with store_search when an existing asset
may help, then use toolbox to discover computer and Git tools from installed
Capsules. When takos-computer and takos-git are available, use standard git
clone, commit, and push plus normal build and test commands through
computer_shell_exec. For a new repository, read TAKOS_GIT_REPO_PREFIX through
computer_shell_exec, pass `<prefix>/<name>` to git_repo_create, and use the
returned URL. Never assume a missing Capsule capability is built into
Takos. Change installs or deploys only through an explicitly available
Takosumi Capsule/Run surface.
