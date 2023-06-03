const { isEmpty, subtract } = require("lodash");
const { v4 } = require("uuid");
const db = require("../../connectors/db");
const roles = require("../../constants/roles");
const { getSessionToken } = require("../../utils/session");

const findUserByEmail = async (email) => {
  // Placeholder implementation to find user by email
  const user = await db
    .select("*")
    .from("se_project.users")
    .where("email", email)
    .first();
  return user;
};

const getUser = async function (req) {
  const sessionToken = getSessionToken(req);
  if (!sessionToken) {
    return res.status(301).redirect("/");
  }
  console.log("hi", sessionToken);
  const user = await db
    .select("*")
    .from("se_project.sessions")
    .where("token", sessionToken)
    .innerJoin(
      "se_project.users",
      "se_project.sessions.userid",
      "se_project.users.id"
    )
    .innerJoin(
      "se_project.roles",
      "se_project.users.roleid",
      "se_project.roles.id"
    )
    .first();

  console.log("user =>", user);
  user.isNormal = user.roleid === roles.user;
  user.isAdmin = user.roleid === roles.admin;
  user.isSenior = user.roleid === roles.senior;
  console.log("user =>", user);
  return user;
};

module.exports = function (app) {
  // Example: Fetch list of users
  app.get("/users", async function (req, res) {
    try {
      const user = await getUser(req);
      const users = await db.select("*").from("se_project.users");
      return res.status(200).json(users);
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Could not get users");
    }
  });

  app.put("/api/v1/password/reset", async function (req, res) {
    try {
      const user = await getUser(req);
      const { newpassword } = req.body;

      await db("se_project.users")
        .where("id", user.userid)
        .update({ password: newpassword });
      return res.status(200).json("Your new password is: " + newpassword);
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("error updating password");
    }
  });

  app.post("/api/v1/senior/request", async function (req, res) {
    try {
      const user = await getUser(req);
      const { nationalId } = req.body;
      const userId = user.userid;

      const newRequest = {
        status: "pending",
        userid: userId,
        nationalid: nationalId,
      };

      const existingRequest = await db("se_project.senior_requests")
        .where({ userid: userId })
        .first();

      if (existingRequest) {
        return res.status(409).send("Senior request already exists for the user");
      }

      await db("se_project.senior_requests").insert(newRequest);

      return res.status(200).send("Request submitted successfully");
    } catch (e) {
      console.log(e.message);
      return res.status(500).send("Request failed");
    }
  });

  app.put("/api/v1/ride/simulate", async function (req, res) {
    try {
      const user = await getUser(req);
      const { origin, destination, tripDate } = req.body;
      const userId = user.userid;

      const ride = await db("se_project.rides")
        .where({
          origin: origin,
          destination: destination,
          tripdate: tripDate,
          userid: userId,
          status: "upcoming"
        })
        .first();

      if (!ride) {
        return res.status(404).send("No upcoming ride found with the provided details");
      }

      await db("se_project.rides")
        .where("id", ride.id)
        .update({ status: "completed" });

      return res.status(200).send("Ride simulation successful");
    } catch (e) {
      console.log(e.message);
      return res.status(500).send("Ride simulation failed");
    }
  });

  app.post("/api/v1/station", async function (req, res) {
    try {
      const user = await getUser(req);

      if (!user || !user.isAdmin) {
        return res.status(403).send("Unauthorized");
      }

      // Check if station already exists in the system
      const stationExists = await db
        .select("*")
        .from("se_project.stations")
        .where("stationname", req.body.stationName);

      if (stationExists.length > 0) {
        return res.status(400).send("This station already exists");
      }

      const newStation = {
        stationname: req.body.stationName,
        stationtype: "normal",
        stationposition: "not connected",
        stationstatus: "new",
      };

      const insertedStation = await db("se_project.stations")
        .insert(newStation)
        .returning("*");

      return res
        .status(200)
        .json("New station is inserted: " + insertedStation);
    } catch (e) {
      console.log(e.message);
      return res.status(500).send("Error adding new station");
    }
  });

  app.get("/api/v1/zones", async function (req, res) {
    try {
      const zones = await db.select("*").from("se_project.zones");
      return res.status(200).json(zones);
    } catch (e) {
      console.log(e.message);
      return res.status(500).send("Error getting zones");
    }
  });

  app.post("/api/v1/refund/:ticketId", async function (req, res) {
    try {
      const { ticketId } = req.params;
      const user = await getUser(req);
      const userId = user.userid;

      if (!ticketId) {
        return res.status(404).json({ message: "Ticket not found" });
      }

      if (ticketId.tripDate < Date.now()) {
        return res
          .status(400)
          .json({ message: "Ticket is not eligible for refund" });
      }

      const refundRequest = {
        status: "pending",
        userid: userId,
        refundamount: 0,
        ticketid: ticketId,
      };

      const insertedRefundRequest = await db("se_project.refund_requests")
        .insert(refundRequest)
        .returning("*");
      res.status(201).json({ message: "Refund request created" });
    } catch (e) {
      console.log(e.message);
      return res.status(500).send("Error requesting refund");
    }
  });

  app.post("/api/v1/route", async function (req, res) {
    try {
      const { newStationId, connectedStationId, routeName } = req.body;
      const user = await getUser(req);
      // Validate user is admin
      if (!user.isAdmin) {
        return res.status(403).send("Unauthorized");
      }

      // Validate station IDs
      const newStation = await db("se_project.stations")
        .select("*")
        .where({ id: newStationId })
        .first();

      if (!newStation) {
        return res.status(404).send("New station not found");
      }

      const newStationStatus = newStation.stationstatus;

      // Check the status of newStationId
      if (newStationStatus === "old") {
        return res
          .status(400)
          .send("This an old station. Cannot add a new route for it");
      }

      // Validate connectedStationId
      const connectedStation = await db("se_project.stations")
        .select("*")
        .where({ id: connectedStationId })
        .first();

      if (!connectedStation) {
        return res.status(404).send("Connected station not found");
      }

      // Get connected station position
      const connectedStationPosition = connectedStation.stationposition;

      // Create the route
      let route;
      if (connectedStationPosition === "start") {
        route = {
          routename: routeName,
          fromstationid: connectedStationId,
          tostationid: newStationId,
        };
        await db("se_project.stations")
          .where("id", newStationId)
          .update({ stationposition: "end" });
      } else if (connectedStationPosition === "end") {
        route = {
          routename: routeName,
          fromstationid: newStationId,
          tostationid: connectedStationId,
        };
        await db("se_project.stations")
          .where("id", newStationId)
          .update({ stationposition: "start" });
      } else {
        return res.status(400).send("Cannot add station in middle of route");
      }

      // Check if route with the same name already exists
      const existingRoute = await db("se_project.routes")
        .select("*")
        .where({ routename: routeName })
        .first();

      if (existingRoute) {
        return res.status(400).send("Route name already exists");
      }

      // Save the route
      const savedRoute = await db("se_project.routes")
        .insert(route)
        .returning("*");

      if (savedRoute.length === 0) {
        throw new Error("Failed to save the route");
      }

      return res.send({ route: savedRoute[0] });
    } catch (e) {
      console.log(e);
      return res.status(500).send("Error adding route");
    }
  });

  app.put("/api/v1/requests/senior/:requestId", async function (req, res) {
    try {
      const user = await getUser(req);
      const { requestId } = req.params;
      const { seniorStatus } = req.body;

      if (!user.isAdmin) {
        return res.status(403).send("Unauthorized");
      }

      await db("se_project.senior_requests")
        .where("id", requestId)
        .update({ status: seniorStatus });

      if (seniorStatus == "accepted") {
        const reqUserId = await db("se_project.senior_requests")
          .select("userid")
          .where("id", requestId)
          .first();
        const requserId2 = reqUserId.userid;
        await db("se_project.users")
          .where("id", requserId2)
          .update({ roleid: 3 });
      }
      return res
        .status(200)
        .json({ message: "Senior request status updated successfully." });
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Error updating senior request status.");
    }
  });

  app.post("/api/v1/payment/ticket", async function (req, res) {
    try {
      const user = await getUser(req);
      const userId = user.userid;

      const priceofticket = 0;

      const {
        creditCardNumber,
        holderName,
        payedAmount,
        origin,
        destination,
        tripDate,
      } = req.body;

      // Apply discount logic here
      let discount = 0;
      if (user.roleid == 3) {
        discount = 50;
      }

      if (payedAmount < priceofticket) {
        return res.status(403)
          .send("Payment is less than the ticket price. Please provide the correct amount to proceed.");
      }

      const discountedAmount = payedAmount - (payedAmount * discount) / 100;

      const ticket = await db("se_project.tickets")
        .insert({
          origin,
          destination,
          userid: userId,
          tripdate: tripDate,
        })
        .returning("*");

      let purchasedId = ticket[0].id;
      const transaction = await db("se_project.transactions")
        .insert({
          amount: discountedAmount,
          userid: userId,
          purchasedid: purchasedId,
          purchasetype: "ticket",
        })
        .returning("*");

      const ride = await db("se_project.rides")
        .insert({
          status: "upcoming",
          origin,
          destination,
          userid: userId,
          ticketid: ticket[0].id,
          tripdate: tripDate,
        })
        .returning("*");

      res.status(200).json({
        message: "Ticket purchased successfully.",
        ticket,
        transaction,
        ride,
        discount: discount + "%",
      });
    }
    catch (e) {
      console.log(e.message);
      res.status(400).send("Error while purchasing the ticket.");
    }
  });

  //check price
  app.get('/api/v1/tickets/price/:originId&:destinationId', async function (req, res) {
    try {
      const { originId, destinationId } = req.params;

      const stationid = await db.select('id').from("se_project.stations");
      const routeid = await db.select('routeid').from('se_project.stationroutes').where('stationid', stationid);

      const origin = await db('se_project.routes').where('id', routeid).andWhere('fromstationid', originId);
      const destination = await db('se_project.routes').where('id', routeid).andWhere('tostationid', destinationId);

      const stations = await db('se_project.stations')
        .whereIn('id', function () {
          this.select('stationid')
            .from('se_project.stationroutes')
            .where('routeid', routeid)
            .andWhere(function () {
              if (origin.stationid < destination.stationid) {
                this.whereBetween('id', [origin.stationid, destination.stationid]);
              } else {
                this.whereBetween('id', [destination.stationid, origin.stationid]);
              }
            });
        });

      const amount = stations.length;
      if (amount === 0) { //no routes where found 
        return res.status(404).send('No routes found for the given origin and destination');
      }
      if (amount <= 9) {
        price = 5;
      }
      else if (amount >= 10 & amount <= 16) {
        price = 7;
      }
      else {
        price = 10;
      }
      res.status(200).send(`Price of ticket: ${price}`);

    } catch (error) {
      console.error('Error checking ticket price:', error);
      return res.status(500).send('An error occurred while checking the ticket price');
    }
  });

  app.put("/api/v1/requests/refunds/:requestId", async function (req, res) {
    try {
      const user = await getUser(req);

      if (!user.isAdmin) {
        return res.status(403).send("Access denied. User is not an admin.");
      }

      const { requestId } = req.params;
      const { refundStatus } = req.body;

      // Get ticketid for further processing
      const reqUserId = await db("se_project.refund_requests")
        .select("ticketid")
        .where("id", requestId)
        .first();
      const reqrefundticket = reqUserId.ticketid;

      const currStatus = await db("se_project.refund_requests")
        .select("status")
        .where("id", requestId)
        .first();

      // if (currStatus.status === "rejected") {
      //   return res.status(403).send("Already rejected!");
      // }

      // Get subid to check if it is null or not
      const ifsub = await db("se_project.tickets")
        .select("subid")
        .where("id", reqrefundticket)
        .first();

      if (refundStatus === "accepted") {
        if (ifsub === null || ifsub.subid === null) {
          const amount = await db("se_project.transactions")
            .select("amount")
            .where("purchasedid", reqrefundticket)
            .first();

          const parsedAmount = parseInt(amount.amount);

          if (isNaN(parsedAmount)) {
            return res.status(400).send("Invalid amount for refund.");
          }

          await db("se_project.refund_requests")
            .where("id", requestId)
            .update({ status: "accepted", refundamount: parsedAmount });

          await db("se_project.rides").where("ticketid", reqrefundticket).del();
          await db("se_project.transactions").where("purchasedid", reqrefundticket).del();

          return res.status(200).json({
            message: "Refund request accepted successfully, amount refunded = " + parsedAmount + " LE"
          });

        } else {
          const parsedSub = parseInt(ifsub.subid);

          if (isNaN(parsedSub)) {
            return res.status(400).send("Invalid subscription ID for refund.");
          }

          const noTickets = await db("se_project.subscription")
            .select("nooftickets")
            .where("id", parsedSub)
            .first();

          if (!noTickets) {
            return res.status(400).send("Subscription not found.");
          }

          const currentNoOfTickets = noTickets.nooftickets;
          const updatedNoOfTickets = currentNoOfTickets + 1;

          await db("se_project.subscription")
            .where("id", parsedSub)
            .update({ nooftickets: updatedNoOfTickets });

          await db("se_project.rides").where("ticketid", reqrefundticket).del();
          await db("se_project.transactions").where("purchasedid", reqrefundticket).del();

          return res.status(200).json({
            message: "Refund request accepted successfully, ticket refunded."
          });
        }
      } else if (refundStatus === "rejected") {
        await db("se_project.refund_requests")
          .where("id", requestId)
          .update({ status: "rejected", refundamount: 0 });

        return res.status(200).send("Refund request is rejected successfully, amount refunded = " + 0 + " LE");
      } else {
        return res.status(400).send("Invalid refund status.");
      }
    } catch (error) {
      console.error(error);
      return res.status(400).send("Error updating refund request.");
    }
  });

  app.get("/api/v1/user_tickets", async function (req, res) {
    try {
      const user = await getUser(req);
      const userId = user.userid;

      const tickets = await db
        .select('*')
        .from('se_project.tickets')
        .where('userid', userId);

      res.status(200).json(tickets);
    } catch (e) {
      console.log(e.message);
      res.status(500).json({ error: "Error retrieving user tickets" });
    }
  });

  app.get('/api/v1/getUser', async function (req, res) {
    try {
      const user = await getUser(req);
      const userId = user.userid;

      const userInfo = await db('se_project.users')
        .select('id', 'firstname', 'lastname', 'email', 'roleid') // Include the roleid column
        .where('id', userId)
        .first();

      res.status(200).json(userInfo);
    } catch (error) {
      console.log(error.message);
      res.status(500).json({ error: 'Error retrieving user information' });
    }
  });

  //get table for front end
  app.get('/api/v1/getSeniorReq', async function (req, res) {
    try {
      const user = await getUser(req);
      const userId = user.userid;

      res.status(200).json(userInfo);
    } catch (error) {
      console.log(error.message);
      res.status(500).json({ error: 'Error retrieving user information' });
    }
  });

  //get table for front end
  app.get('/api/v1/seniorRequests', async function (req, res) {
    try {
      const seniorRequests = await db('se_project.senior_requests').select('*');
      res.json(seniorRequests);
    } catch (err) {
      console.error('Error retrieving senior requests:', err);
      res.status(500).json({ error: 'An error occurred while retrieving senior requests.' });
    }
  });


  //get table for front end
  app.get('/api/v1/refundRequests', async function (req, res) {
    try {
      const refundRequests = await db('se_project.refund_requests').select('*');
      res.json(refundRequests);
    } catch (e) {
      console.error('Error retrieving refund requests:', e);
      res.status(500).json({ error: 'An error occurred while retrieving refund requests.' });
    }
  });

  app.put("/api/v1/route/:routeId", async function (req, res) {
    try {
      const user = await getUser(req);

      if (!user.isAdmin) {
        return res.status(403).send("Access denied. User is not an admin.");
      }

      const { routeId } = req.params;
      const { routeName } = req.body;

      // Perform validation and error handling if necessary

      // Update route logic
      await db("se_project.routes")
        .where("id", routeId)
        .update({ routename: routeName });

      return res.status(200).json({ message: "Route updated successfully." });
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Error updating route.");
    }
  });

  app.put("/api/v1/station/:stationId", async function (req, res) {
    try {
      const user = await getUser(req);

      if (!user.isAdmin) {
        return res.status(403).send("Access denied. User is not an admin.");
      }

      const { stationId } = req.params;
      const { stationName } = req.body;

      // Update station logic
      await db("se_project.stations")
        .where("id", stationId)
        .update({ stationname: stationName });

      return res.status(200).json({ message: "Station updated successfully." });
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Error updating station.");
    }
  });

  //get table for front end
  app.get('/api/v1/stations', async function (req, res) {
    try {
      const stations = await db('se_project.stations').select('*');
      res.json(stations);
    } catch (e) {
      console.error('Error retrieving refund requests:', e);
      res.status(500).json({ error: 'An error occurred while retrieving refund requests.' });
    }
  });

  //get rides of user
  app.get("/api/v1/ridesUser", async function (req, res) {
    try {
      const user = await getUser(req);
      const userId = user.userid;

      const rides = await db
        .select('*')
        .from('se_project.rides')
        .where('userid', userId);

      res.status(200).json(rides);
    } catch (e) {
      console.log(e.message);
      res.status(500).json({ error: "Error retrieving user rides" });
    }
  });
};
