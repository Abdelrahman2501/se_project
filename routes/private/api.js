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
        .update({ password: newpassword })
      return res.status(200).json("Your new password is: " + newpassword);
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("error updating password");
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

  

  app.post("/api/v1/route", async function (req, res) {
    try {
      const user = await getUser(req);
  
      if (!user.isAdmin) {
        return res.status(403).send("Unauthorized");
      }
  
      const { newStationId, connectedStationId, routeName } = req.body;
      let fromStationId, toStationId;
      const connectedStation = await db("se_project.stations")
        .select("*")
        .where({ id: connectedStationId })
        .first();
  
      if (!connectedStation) {
        return res.status(404).send("Connected station not found");
      }
  
      const connectedStationPosition = connectedStation.stationposition;
  
      if (
        connectedStationPosition !== "start" &&
        connectedStationPosition !== "end"
      ) {
        console.log(
          'Invalid position. Only "start" or "end" positions are allowed.'
        );
        return res
          .status(400)
          .send('Invalid position. Only "start" or "end" positions are allowed.');
      }
  
      const routeExists = await db
        .select("*")
        .from("se_project.routes")
        .where("routename", req.body.routeName);
  
      if (routeExists.length > 0) {
        return res.status(400).send("This route already exists");
      }
  
      if (connectedStationPosition === "start") {
        fromStationId = connectedStationId;
        toStationId = connectedStationId + 1;
      } else if (connectedStationPosition === "end") {
        fromStationId = connectedStationId - 1;
        toStationId = connectedStationId;
      } else {
        return res.status(401).send("Only admin users can create routes");
      }
  
      const newRoute = {
        routename: routeName,
        fromstationid: fromStationId,
        tostationid: toStationId,
      };
  
      const insertedRoute = await db("se_project.routes")
        .insert(newRoute)
        .returning("*");
  
      // Update station positions
      await db("se_project.stations")
        .update({ stationposition: "start" })
        .where("id", fromStationId);
  
      await db("se_project.stations")
        .update({ stationposition: "end" })
        .where("id", toStationId);
  
      console.log("Route has been created successfully");
      return res.status(200).json(insertedRoute);
    } catch (error) {
      console.log(error.message);
      return res.status(500).send("Could not create new route");
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
    }4444444444444444444444444444444444444444444444
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
  
      if (!stationName) {
        return res.status(400).send("Station name is required.");
      }
  
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
  
  app.delete('/api/v1/route/:routeId', async (req, res) => {
    try {
      const user = await getUser(req);
      if (user.isAdmin) {
        const routeId = req.params.routeId;
        //const stationId= req.params.stationId;
        const routeDelete = await db('se_project.routes').where('id', routeId);
        console.log(routeDelete)
        if (routeDelete.length== 0) {
          return res.status(404).json({ error: 'Route not found' });
          
        }
        
        const { fromstationid, tostationid } = routeDelete[0];
        
        
  
        //update position el 1 wla el 2
        //check el route elly 3kso el to bt3to l 1 w from htb2a 2 mowgod wla la w en el 2 tb2a start
        //msh mowgod position null from htkon null
        //mowgod msh h3ml haga
       console.log(tostationid);
       console.log(fromstationid);
      // Updating the position of the stations
      const nextStation = await db('se_project.routes').where('tostationid', fromstationid).first();
      if (nextStation) {
        await db('se_project.stations').where('id', nextStation.fromstationid).update({ stationposition: 'start' });
      
      }
      console.log(nextStation);
      const prevStation = await db('se_project.routes').where('tostationid', tostationid).first();
      if (prevStation) {
        await db('se_project.stations').where('id', prevStation.fromstationid).update({ stationposition: 'start' });
      }
      console.log(prevStation);
      console.log('Route and connected stations deleted successfully');
      await db('se_project.routes').where('id', routeId).del();
      return res.status(200).json({ message: 'Route and connected stations deleted successfully' });
    
    }
    // else if(prevStation == stationposition){
  //}
      else {
      return res.status(403).json({ error: 'Unauthorized' });
    }
  } catch (error) {
    console.log(error.message);
    return res.status(500).json({ error: 'Cannot delete the route' });
  }
  });
  app.delete('/api/v1/station/:stationId', async (req, res) => {
    try {
      const user = await getUser(req);
      if (user.isAdmin) {
        const stationId = req.params.stationId;
  
        // Find the station to delete
        const stationToDelete = await db('se_project.stations')
          .where('id', '=', stationId)
          .first();
  
        if (!stationToDelete) {
          return res.status(404).json({ message: 'Station not found' });
        }
  
        const { stationposition, stationtype } = stationToDelete;
        
        if (stationtype === 'normal' && stationposition === 'start') {
          // Delete the station
          await db('se_project.stations')
            .where('id', '=', stationId)
            .del();
  
          // Find the next station
          const nextStation = await db('se_project.routes')
            .where('tostationid', '=', stationId)
            .first();
  
          if (nextStation) {
            // Update the stationposition of the next station to "start"
            await db('se_project.stations')
              .where('id', nextStation.fromstationid)
              .update({ stationposition: 'start' });
          }
        }
  
        if (stationtype === 'normal' && stationposition === 'middle') {
          // Find the next station
          const nextStation = await db('se_project.routes')
            .where('tostationid', '=', stationId)
            .first();
  
          // Delete the station
          await db('se_project.stations')
            .where('id', '=', nextStation.tostationid)
            .del();
  
          // Create a new route and stationroute record
          const newRoute1 = {
            routename: 'newRoute1',
            fromstationid: nextStation.fromstationid,
            tostationid: nextStation.tostationid,
          };
  
          const insertedRoute1 = await db('se_project.routes')
            .insert(newRoute1)
            .returning('*');
  
          const newSR1 = {
            stationid: nextStation.tostationid,
            routeid: insertedRoute1[0].id,
          };
  
          await db('se_project.stationroutes').insert(newSR1);
  
          const newRoute2 = {
            routename: 'newRoute2',
            fromstationid: stationToDelete.fromstationid,
            tostationid: nextStation.tostationid,
          };
  
          const insertedRoute2 = await db('se_project.routes')
            .insert(newRoute2)
            .returning('*');
  
          const newSR2 = {
            stationid: nextStation.tostationid,
            routeid: insertedRoute2[0].id,
          };
  
          await db('se_project.stationroutes').insert(newSR2);
        }
  
        if (stationtype === 'transfer' && stationposition === 'middle') {
          // Delete the station
          await db('se_project.stations')
            .where('id', '=', stationId)
            .del();
  
          // Find the previous and next stations
          const prevStation = await db('se_project.routes')
            .where('tostationid', '=', stationId)
            .first();
  
          const nextStation = await db('se_project.routes')
            .where('fromstationid', '=', stationId)
            .first();
  
          if (prevStation && nextStation) {
            // Update the route from prevStation to nextStation
            await db('se_project.routes')
              .where('fromstationid', '=', prevStation.fromstationid)
              .andWhere('tostationid', '=', stationId)
              .update({ tostationid: nextStation.tostationid });
  
            // Delete the route from prevStation to current station (transfer station)
            await db('se_project.routes')
              .where('fromstationid', '=', prevStation.fromstationid)
              .andWhere('tostationid', '=', stationId)
              .del();
  
            // Update the stationposition of the next station to "middle"
            await db('se_project.stations')
              .where('id', '=', nextStation.tostationid)
              .update({ stationposition: 'middle' });
  
            // Create a new route and stationroute record
            const newRoute = {
              routename: 'newRoute',
              fromstationid: prevStation.fromstationid,
              tostationid:
                nextStation.fromstationid === stationId
                  ? nextStation.tostationid
                  : nextStation.fromstationid,
            };
  
            const insertedRoute = await db('se_project.routes')
              .insert(newRoute)
              .returning('*');
  
            const newSR = {
              stationid: insertedRoute[0].tostationid,
              routeid: insertedRoute[0].id,
            };
  
            await db('se_project.stationroutes').insert(newSR);
          }
        }
  
        if (stationtype === 'normal' && stationposition === 'end') {
          // Delete the station
          await db('se_project.stations')
            .where('id', '=', stationId)
            .del();
  
          // Find the previous station
          const prevStation = await db('se_project.routes')
            .where('fromstationid', '=', stationId)
            .first();
  
          if (prevStation) {
            // Update the stationposition of the previous station to "end"
            await db('se_project.stations')
              .where('id', prevStation.tostationid)
              .update({ stationposition: 'end' });
          }
        }
      }
  
      return res.status(200).json({ message: 'Station deleted successfully' });
    } catch (e) {
      console.error('Error deleting station:', e);
      return res.status(400).json({ message: 'Could not delete station' });
    }
  });
  
  // CREATE STATION (ADMIN) => RUNS PERFECTLY
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
        .where("stationname", req.body.stationname);
  
      if (stationExists.length > 0) {
        return res.status(400).send("This station already exists");
      }
  
      const newStation = {
        stationname: req.body.stationname,
        stationtype: "normal",
        stationposition: "start",
        stationstatus: "new created",
      };
      const insertedStation = await db("se_project.stations").insert(newStation).returning("*");
      return res.status(200).json(insertedStation);
    } catch (error) {
      console.log(error.message);
      return res.status(500).send("Could not create new station");
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
  
  //UPDATE ZONE PRICES -ADMIN
app.put("/api/v1/zones/:zoneId", async function (req, res) {
  try {
    const user = await getUser(req);

    if (!user.isAdmin) {
      return res.status(403).send("Access denied. User is not an admin.");
    }

    const { zoneId } = req.params;
    const { price } = req.body;

    // Perform validation and error handling if necessary

    // Update zone logic
    await db("se_project.zones").where("id", zoneId).update({ price });

    return res.status(200).json({ message: "Zone price updated successfully." });
  } catch (e) {
    console.log(e.message);
    return res.status(400).send("Error updating zone price.");
  }
});




};

