# Designs have their own sync tables

Designs sync through Yjs and Convex, like Code's files. Code's `crdtDocuments` and
`appendUpdate` assume a Program with files and a ready Pierre repository, which a Design
does not have, and generalizing them would put a working editor at risk. Designs get
separate tables that copy the same update pattern, with no repository behind them, so
they have no git-style version history for now.
