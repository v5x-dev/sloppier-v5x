#include "main.h"


// Four accounts editing src/main.cpp together
void initialize() {
  pros::lcd::initialize(); // Alice
}


void autonomous() {
  pros::delay(1000); // Ben
}


void disabled() {
  pros::lcd::clear(); // Clara
}


void opcontrol() {
  pros::delay(20); // Diego
}

