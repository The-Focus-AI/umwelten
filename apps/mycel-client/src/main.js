import "./styles.css";
import "./mycelium.js";
import { initializeAuthentication } from "./authentication.js";
import { updateCustomerSession } from "./customer.js";

void initializeAuthentication({ onStateChange: updateCustomerSession });
