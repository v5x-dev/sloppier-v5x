# v5x

A suite of tools for VEX V5 robotics teams. These terms mean the same thing across
the products.

## Language

**Workspace**:
A team's shared home, holding any number of Programs and Designs. Links between a
Program and a Design are not defined yet.
_Avoid_: Team, organization, project

**Program**:
A robot program written in the Code product.
_Avoid_: Project, repo

**Design**:
A saved robot document made in the Design product, from a whole robot down to a single
mechanism. Written "the Design app" when the product is meant.
_Avoid_: Model, project

**Build**:
A compile of a Program on the build farm. It never means a saved Design.
_Avoid_: Compile job

## Designs

**Part**:
One physical VEX component placed in a Design, such as a motor or a screw.
_Avoid_: Object, component, instance

**Catalog**:
The list of every kind of Part that can be placed in a Design.
_Avoid_: Library, inventory

**Cut Part**:
A channel, angle, or shaft at a length chosen by the team rather than the length VEX sells.
_Avoid_: Custom part, parametric part

**Snap Point**:
A place on a Part where another Part can line up, usually a hole.
_Avoid_: Anchor, attachment point

**Connection**:
A saved link made by a screw or shaft through aligned holes. Connected Parts move together.
One screw or shaft allows rotation around it; two or more make the Parts rigid.
_Avoid_: Joint, constraint, mate

**Field Element**:
A game field or game object from a VEX season, placed in a Design for reference.
_Avoid_: Game piece, game object
