# Design is built independently of Protobot

The Design app aims for feature parity with Protobot-Rebuilt, which is GPL-3.0. A web app
ships its code to every browser, so reusing that project's code could put Design under
the GPL. We use Protobot only as a reference for behaviour: no ported C#, none of its 3D
models, and none of its weight data.

Part models are converted from VEX's own STEP files instead. We have not sought VEX's
permission to host the converted models, and we chose not to make that a launch condition.
